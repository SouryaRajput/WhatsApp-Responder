"""
[EC-14] Double-check opt-out before sending
[EC-15] Proper async handling
[EC-16] Max follow-up cap
[EC-22] Skip expired conversations
"""

import asyncio
import logging
from datetime import datetime
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from app.database import Database
from app.whatsapp import send_message
from app.state_machine import get_question
from app.config import settings
from app.locks import lock_manager

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()


async def _send_reminders():
    """Send 24h reminders to inactive conversations with 0 reminders."""
    try:
        conversations = await Database.get_inactive_conversations(
            hours=settings.REMINDER_HOURS,
            min_reminders=0,
        )

        for conv in conversations:
            phone = conv["phone"]

            # [EC-14] Double-check opt-out status
            fresh = await Database.get_conversation(phone)
            if not fresh or fresh.get("opted_out") or fresh.get("completed"):
                continue

            state = fresh.get("state", "intent")
            question = get_question(state)

            # [EC-01] Acquire lock before sending + updating
            lock = await lock_manager.acquire(phone)
            try:
                await send_message(
                    phone,
                    f"Hey! Still looking for a property? 😊\n{question}",
                )
                await Database.update_conversation(phone, {"reminders_sent": 1})
                logger.info(f"24h reminder sent to {phone}")
            finally:
                lock_manager.release(phone, lock)

            # Small delay between messages to avoid rate limiting
            await asyncio.sleep(1)

    except Exception as e:
        logger.error(f"Error in _send_reminders: {e}", exc_info=True)


async def _send_followups():
    """Send 3-day follow-ups to conversations with ≥1 reminder."""
    try:
        conversations = await Database.get_inactive_conversations(
            hours=settings.FOLLOWUP_HOURS,
            min_reminders=1,
        )

        for conv in conversations:
            phone = conv["phone"]

            # [EC-14] Double-check opt-out status
            fresh = await Database.get_conversation(phone)
            if not fresh or fresh.get("opted_out") or fresh.get("completed"):
                continue

            # [EC-16] Respect max follow-ups
            if fresh.get("reminders_sent", 0) >= settings.MAX_FOLLOWUPS:
                continue

            lock = await lock_manager.acquire(phone)
            try:
                await send_message(
                    phone,
                    "Hi! Just checking in — are you still looking for a property? "
                    "Reply to continue or type 'stop' to opt out.",
                )
                await Database.update_conversation(phone, {
                    "reminders_sent": fresh.get("reminders_sent", 0) + 1,
                })
                logger.info(f"72h follow-up sent to {phone}")
            finally:
                lock_manager.release(phone, lock)

            await asyncio.sleep(1)

    except Exception as e:
        logger.error(f"Error in _send_followups: {e}", exc_info=True)


async def run_followup_checks():
    """[EC-15] Properly awaited async entry point for scheduler."""
    await _send_reminders()
    await _send_followups()
    # [EC-24] Cleanup stale locks periodically
    await lock_manager.cleanup_stale()


def start_scheduler():
    """Start the APScheduler for periodic follow-up checks."""
    scheduler.add_job(
        lambda: asyncio.ensure_future(run_followup_checks()),
        "interval",
        hours=1,
        id="followup_check",
        replace_existing=True,
    )
    scheduler.start()
    logger.info("Follow-up scheduler started (runs every hour)")