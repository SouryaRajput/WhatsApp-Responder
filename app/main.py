import logging
import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response, HTTPException

from app.config import settings
from app.database import Database
from app.orchestrator import handle_message
from app.followup import start_scheduler, scheduler
from app.security import (
    normalize_phone,
    sanitize_input,
)
from app.locks import lock_manager

# ── logging ────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)
logger = logging.getLogger(__name__)


# ── app lifespan ───────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting up…")
    await Database.connect()

    if Database.is_connected():
        start_scheduler()
    else:
        logger.warning(
            "MongoDB not available — scheduler NOT started. "
            "App running in degraded mode."
        )

    yield

    logger.info("Shutting down…")
    try:
        scheduler.shutdown(wait=False)
    except Exception:
        pass
    await Database.close()
    await lock_manager.cleanup_stale()


app = FastAPI(
    title="WhatsApp Lead Qualifier",
    version="2.0.0",
    lifespan=lifespan,
)


# ── DB availability check ─────────────────────────────────────────

async def _ensure_db() -> bool:
    if Database.is_connected():
        return True
    reconnected = await Database.check_connection()
    if reconnected:
        logger.info("MongoDB reconnected!")
        try:
            await Database._create_indexes()
        except Exception:
            pass
    return reconnected


# ── Twilio webhook ────────────────────────────────────────────────
@app.post("/webhook/whatsapp")
async def whatsapp_webhook(request: Request):
    form_data = await request.form()
    form_dict = dict(form_data)

    # ── DEBUG LOGGING ─────────────────────────────────────────────
    logger.info("=" * 50)
    logger.info("📱 INCOMING WHATSAPP WEBHOOK")
    logger.info(f"  From      : {form_dict.get('From', 'N/A')}")
    logger.info(f"  Body      : {form_dict.get('Body', 'N/A')}")
    logger.info(f"  MessageSid: {form_dict.get('MessageSid', 'N/A')}")
    logger.info(f"  ProfileName: {form_dict.get('ProfileName', 'N/A')}")
    logger.info(f"  All keys  : {list(form_dict.keys())}")
    logger.info("=" * 50)

    # ── SIGNATURE VERIFICATION (disabled for sandbox testing) ─────
    # IMPORTANT: Re-enable this when going to production!
    # See the commented block below for the production version.
    if not settings.DRY_RUN:
        signature = request.headers.get("X-Twilio-Signature", "")
        url = str(request.url)
        logger.info(f"  Signature : {signature[:20]}..." if signature else "  Signature : NONE")
        logger.info(f"  URL used  : {url}")
        # Skipping signature verification for sandbox/ngrok testing
        # because ngrok rewrites the URL from https:// to http://localhost
        # which breaks the HMAC signature.
        #
        # TO RE-ENABLE IN PRODUCTION:
        # from app.security import verify_twilio_signature
        # if not verify_twilio_signature(url, form_dict, signature):
        #     logger.warning(f"Invalid Twilio signature from {request.client.host}")
        #     raise HTTPException(status_code=403, detail="Invalid signature")

    from_number = form_data.get("From", "")
    message_body = form_data.get("Body", "").strip()
    message_sid = form_data.get("MessageSid", "")
    num_media = int(form_data.get("NumMedia", 0))

    phone = normalize_phone(from_number)
    logger.info(f"  Normalized phone: {phone}")

    if not phone:
        logger.warning("  No phone number found, returning 200")
        return Response(content="", status_code=200)

    # Check DB availability
    if not await _ensure_db():
        logger.error("Cannot process message — MongoDB unavailable")
        asyncio.ensure_future(_send_db_error(phone))
        return Response(content="", status_code=200)

    if num_media > 0 and not message_body:
        message_body = "I sent an image"

    if not message_body:
        logger.warning("  Empty message body, returning 200")
        return Response(content="", status_code=200)

    if len(message_body) > settings.MAX_USER_MESSAGE_LENGTH:
        message_body = message_body[:settings.MAX_USER_MESSAGE_LENGTH]

    # Process in background
    logger.info(f"  ➡️ Processing message: '{message_body}'")
    asyncio.ensure_future(handle_message(phone, message_body, message_sid))

    # Return 200 immediately (Twilio requires fast response)
    return Response(content="", status_code=200)


async def _send_db_error(phone: str):
    from app.whatsapp import send_message
    await send_message(
        phone,
        "We're experiencing technical issues. Please try again in a few minutes. 🙏",
    )


# ── health check ──────────────────────────────────────────────────
@app.get("/health")
async def health():
    db_ok = await Database.check_connection()
    return {
        "status": "ok" if db_ok else "degraded",
        "mode": "dry_run" if settings.DRY_RUN else "live",
        "mongodb": "connected" if db_ok else "disconnected",
    }


# ── test endpoint ─────────────────────────────────────────────────
@app.post("/test/message")
async def test_message(request: Request):
    if not settings.ENABLE_TEST_ENDPOINT and not settings.DRY_RUN:
        raise HTTPException(status_code=404, detail="Not found")

    try:
        body = await request.json()
    except Exception:
        return {
            "status": "error",
            "error": "Request body must be valid JSON",
            "example": {"phone": "+919876543210", "message": "hi"},
        }

    phone = body.get("phone", "+919999999999")
    message = body.get("message", "")

    if not phone or not message:
        return {
            "status": "error",
            "error": "Both 'phone' and 'message' are required",
        }

    if len(message) > settings.MAX_USER_MESSAGE_LENGTH:
        message = message[:settings.MAX_USER_MESSAGE_LENGTH]

    if not await _ensure_db():
        return {"status": "error", "error": "MongoDB unavailable"}

    await handle_message(phone, message)
    return {"status": "processed", "phone": phone, "message": message}