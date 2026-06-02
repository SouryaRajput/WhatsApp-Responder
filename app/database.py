import asyncio
import logging
import re
from datetime import datetime, timedelta, timezone
from urllib.parse import quote_plus, unquote
from motor.motor_asyncio import AsyncIOMotorClient
from app.config import settings

logger = logging.getLogger(__name__)


def _escape_mongo_uri(uri: str) -> str:
    scheme_end = uri.find("://")
    if scheme_end == -1:
        return uri

    scheme = uri[: scheme_end + 3]
    rest = uri[scheme_end + 3 :]

    slash_pos = rest.find("/")
    authority = rest[:slash_pos] if slash_pos != -1 else rest
    path_etc = rest[slash_pos:] if slash_pos != -1 else ""

    at_pos = authority.rfind("@")
    if at_pos == -1:
        return uri

    userinfo = authority[:at_pos]
    host_part = authority[at_pos + 1 :]

    colon_pos = userinfo.find(":")
    if colon_pos == -1:
        return uri

    username = userinfo[:colon_pos]
    password = userinfo[colon_pos + 1 :]

    username = quote_plus(unquote(username))
    password = quote_plus(unquote(password))

    return f"{scheme}{username}:{password}@{host_part}{path_etc}"


def _mask_uri(uri: str) -> str:
    match = re.match(r"^(mongodb(?:\+srv)?://[^:]+:)([^@]+)(@.+)$", uri)
    if match:
        return f"{match.group(1)}****{match.group(3)}"
    return uri


class Database:
    client: AsyncIOMotorClient = None
    db = None
    _connected: bool = False

    @classmethod
    async def connect(cls):
        raw_uri = settings.MONGO_URI

        # ── DIAGNOSTIC LOGGING ────────────────────────────────────
        logger.info(f"Raw MONGO_URI length: {len(raw_uri)}")
        logger.info(f"Raw MONGO_URI starts with: {raw_uri[:30]}...")
        logger.info(f"Raw MONGO_URI ends with: ...{raw_uri[-30:]}")
        logger.info(f"Contains 'mongodb': {'mongodb' in raw_uri}")
        logger.info(f"Contains '@': {'@' in raw_uri}")

        if not raw_uri or "mongodb" not in raw_uri:
            logger.error(
                "MONGO_URI is empty or invalid! "
                "Check your .env file — make sure the URI is in DOUBLE QUOTES.\n"
                'Example: MONGO_URI="mongodb+srv://user:pass@cluster.mongodb.net/"'
            )
            cls._connected = False
            return

        escaped_uri = _escape_mongo_uri(raw_uri)
        logger.info(f"Escaped MONGO_URI: {_mask_uri(escaped_uri)}")

        cls.client = AsyncIOMotorClient(
            escaped_uri,
            serverSelectionTimeoutMS=15000,
            connectTimeoutMS=15000,
            socketTimeoutMS=20000,
            retryWrites=True,
        )
        cls.db = cls.client[settings.DB_NAME]

        try:
            await asyncio.wait_for(cls.client.admin.command("ping"), timeout=18)
            cls._connected = True
            logger.info("✅ MongoDB connected successfully")
        except Exception as e:
            cls._connected = False
            error_str = str(e)

            # Provide actionable advice
            if "AuthenticationFailed" in error_str or "auth" in error_str.lower():
                logger.error(
                    "❌ MongoDB authentication failed! "
                    "Check your username and password in the URI."
                )
            elif "ENOTFOUND" in error_str or "nodename" in error_str:
                logger.error(
                    "❌ MongoDB hostname not found! "
                    "Check your cluster URL in the URI."
                )
            elif "Network" in error_str or "timed out" in error_str or "Connection refused" in error_str:
                logger.error(
                    "❌ Cannot reach MongoDB! Most likely cause: your IP is not whitelisted.\n"
                    "   Fix: Go to Atlas → Network Access → Add Current IP Address\n"
                    "   Or temporarily: Add IP 0.0.0.0/0 (allow all)"
                )
            else:
                logger.warning(
                    f"MongoDB not available yet: {e}. "
                    f"App will start in degraded mode."
                )

        try:
            await cls._create_indexes()
        except Exception as e:
            logger.warning(f"Could not create indexes yet: {e}")

    @classmethod
    async def _create_indexes(cls):
        if cls.db is None:
            return
        await cls.db.conversations.create_index("phone", unique=True)
        await cls.db.conversations.create_index("last_message_at")
        await cls.db.processed_messages.create_index("message_sid", unique=True)
        await cls.db.processed_messages.create_index(
            "created_at", expireAfterSeconds=86400
        )

    @classmethod
    async def check_connection(cls) -> bool:
        try:
            await asyncio.wait_for(cls.client.admin.command("ping"), timeout=8)
            cls._connected = True
        except Exception:
            cls._connected = False
        return cls._connected

    @classmethod
    def is_connected(cls) -> bool:
        return cls._connected

    @classmethod
    async def close(cls):
        if cls.client:
            cls.client.close()

    @classmethod
    async def is_message_processed(cls, message_sid: str) -> bool:
        if not message_sid:
            return False
        try:
            existing = await cls.db.processed_messages.find_one(
                {"message_sid": message_sid}
            )
            return existing is not None
        except Exception:
            return False

    @classmethod
    async def mark_message_processed(cls, message_sid: str):
        if not message_sid:
            return
        try:
            await cls.db.processed_messages.insert_one(
                {"message_sid": message_sid, "created_at": datetime.now(timezone.utc)}
            )
        except Exception:
            pass

    @classmethod
    async def get_conversation(cls, phone: str) -> dict | None:
        try:
            return await cls.db.conversations.find_one({"phone": phone})
        except Exception as e:
            logger.error(f"DB error getting conversation for {phone}: {e}")
            return None

    @classmethod
    async def create_conversation(cls, phone: str) -> dict:
        now = datetime.now(timezone.utc)
        doc = {
            "phone": phone,
            "state": "intent",
            "intent": None,
            "data": cls._empty_data(),
            "score": None,
            "score_label": None,
            "created_at": now,
            "updated_at": now,
            "last_message_at": now,
            "reminders_sent": 0,
            "completed": False,
            "broker_notified": False,
            "opted_out": False,
            "version": 0,
        }
        try:
            await cls.db.conversations.insert_one(doc)
            return doc
        except Exception as e:
            logger.error(f"DB error creating conversation for {phone}: {e}")
            raise

    @classmethod
    async def update_conversation(
        cls, phone: str, update: dict, expected_version: int | None = None
    ) -> bool:
        now = datetime.now(timezone.utc)
        set_fields = {"updated_at": now, "last_message_at": now}

        for key, value in update.items():
            if key == "data":
                for data_key, data_value in value.items():
                    if data_value is not None:
                        set_fields[f"data.{data_key}"] = data_value
            elif key == "version":
                continue
            else:
                set_fields[key] = value

        set_fields["version"] = (expected_version or 0) + 1

        query = {"phone": phone}
        if expected_version is not None:
            query["version"] = expected_version

        try:
            result = await cls.db.conversations.update_one(query, {"$set": set_fields})
            return result.modified_count > 0 or result.upserted_id is not None
        except Exception as e:
            logger.error(f"DB error updating conversation for {phone}: {e}")
            return False

    @classmethod
    async def get_inactive_conversations(cls, hours: int, min_reminders: int = 0):
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
        expiry = datetime.now(timezone.utc) - timedelta(days=settings.CONVERSATION_EXPIRY_DAYS)
        query = {
            "last_message_at": {"$lt": cutoff, "$gt": expiry},
            "completed": False,
            "opted_out": False,
            "reminders_sent": {"$gte": min_reminders, "$lt": settings.MAX_FOLLOWUPS},
        }
        try:
            return await cls.db.conversations.find(query).to_list(length=100)
        except Exception as e:
            logger.error(f"DB error getting inactive conversations: {e}")
            return []

    @staticmethod
    def _empty_data() -> dict:
        return {
            "budget_min": None,
            "budget_max": None,
            "location": None,
            "timeline": None,
            "timeline_days": None,
            "loan_status": None,
            "rent_min": None,
            "rent_max": None,
            "move_in_timeline": None,
            "move_in_days": None,
            "property_type": None,
        }