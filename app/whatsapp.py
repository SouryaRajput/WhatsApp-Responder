import asyncio
import logging
from twilio.rest import Client
from app.config import settings

logger = logging.getLogger(__name__)

_client = None


def _get_client() -> Client:
    global _client
    if _client is None:
        _client = Client(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)
    return _client


def _split_message(body: str, max_length: int = 1500) -> list[str]:
    if len(body) <= max_length:
        return [body]

    chunks = []
    while body:
        if len(body) <= max_length:
            chunks.append(body)
            break

        split_at = body.rfind('\n', 0, max_length)
        if split_at == -1:
            split_at = body.rfind(' ', 0, max_length)
        if split_at == -1:
            split_at = max_length

        chunks.append(body[:split_at].strip())
        body = body[split_at:].strip()

    return chunks


async def send_message(to: str, body: str) -> str | None:
    if settings.DRY_RUN:
        # Clean conversational output for terminal testing
        print(f"\n🤖 BOT: {body}\n")
        return "dry_run"

    chunks = _split_message(body)
    last_sid = None

    for chunk in chunks:
        try:
            twilio = _get_client()

            def _send(msg_body=chunk):
                return twilio.messages.create(
                    from_=f"whatsapp:{settings.TWILIO_WHATSAPP_NUMBER}",
                    body=msg_body,
                    to=f"whatsapp:{to}",
                )

            msg = await asyncio.to_thread(_send)
            last_sid = msg.sid
            logger.info(f"Message sent: {msg.sid}")

            if len(chunks) > 1:
                await asyncio.sleep(0.5)

        except Exception as e:
            logger.error(f"WhatsApp send error to {to}: {e}")
            return None

    return last_sid