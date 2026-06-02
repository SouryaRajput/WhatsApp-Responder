"""
[EC-01] Per-phone mutex prevents concurrent corruption
[EC-02] Idempotency via MessageSid
[EC-03] Multi-value extraction: skip ahead to next unsatisfied state
[EC-05] LLM failure doesn't leave user stuck
[EC-09] User can update previous answers
[EC-10] Minimum data check before marking complete
"""

import logging
import httpx
from app.database import Database
from app.state_machine import (
    get_next_unsatisfied_state,
    get_question,
    is_complete,
    is_state_satisfied,
    minimum_data_met,
    BUY_FLOW,
    RENT_FLOW,
)
from app.extractor import extract_data
from app.scorer import score_buy_lead, score_rent_lead
from app.whatsapp import send_message
from app.config import settings
from app.locks import lock_manager
from app.security import (
    normalize_phone,
    rate_limiter,
    sanitize_input,
)

logger = logging.getLogger(__name__)

OPT_OUT_KEYWORDS = {"stop", "unsubscribe", "opt out", "cancel", "quit", "no more"}


async def handle_message(
    phone: str,
    message_body: str,
    message_sid: str | None = None,
):
    """
    Main entry point — called for every incoming WhatsApp message.
    [EC-01] Acquires per-phone mutex to prevent concurrent processing.
    """
    # [EC-08] Normalize phone number
    phone = normalize_phone(phone)

    # [EC-02] Idempotency check
    if message_sid and await Database.is_message_processed(message_sid):
        logger.info(f"Duplicate message {message_sid}, skipping")
        return

    # [EC-06] Rate limiting
    allowed, reason = rate_limiter.is_allowed(phone)
    if not allowed:
        logger.warning(f"Rate limited {phone}: {reason}")
        await send_message(phone, "You're sending messages too fast. Please wait a moment. ⏳")
        return

    # ── acquire per-phone mutex ───────────────────────────────────
    lock = await lock_manager.acquire(phone)
    try:
        await _process_message(phone, message_body)

    except Exception as e:
        import traceback
        error_details = f"{type(e).__name__}: {str(e)[:100]}"
        print("\n" + "="*60)
        print(f"🔥 CRITICAL ERROR: {error_details}")
        print("="*60)
        traceback.print_exc()
        print("="*60 + "\n")
        logger.error(f"Error processing message from {phone}: {e}", exc_info=True)
        try:
            # Send the ACTUAL error to WhatsApp so we can see it
            await send_message(phone, f"⚠️ Bot Error: {error_details}")
        except Exception:
            pass

    finally:
        lock_manager.release(phone, lock)
        
    # [EC-02] Mark message as processed after successful handling
    if message_sid:
        await Database.mark_message_processed(message_sid)


async def _process_message(phone: str, message_body: str):
    """Internal processing logic, already under per-phone mutex."""

    # ── sanitize input ────────────────────────────────────────────
    message_body = sanitize_input(message_body)

    if not message_body:
        await send_message(phone, "Could you please type your message? 😊")
        return

    # ── opt-out check ─────────────────────────────────────────────
    if message_body.lower().strip() in OPT_OUT_KEYWORDS:
        await Database.update_conversation(phone, {
            "completed": True,
            "opted_out": True,
            "state": "opted_out",
        })
        await send_message(phone, "You've been unsubscribed. Reply anytime to start again. 👋")
        return

    # ── load or create conversation ───────────────────────────────
    conversation = await Database.get_conversation(phone)

    if conversation is None:
        # First message from this user
        conversation = await Database.create_conversation(phone)

    current_state = conversation["state"]
    intent = conversation.get("intent")
    conv_data = conversation.get("data", {}) or {}
    version = conversation.get("version", 0)

    # ── handle already-completed conversations ────────────────────
    if conversation.get("completed") and not conversation.get("opted_out"):
        # Check if user wants to start a new search
        extraction = await extract_data("intent", None, message_body)
        new_intent = extraction.get("data", {}).get("intent")
        if new_intent in ("buy", "rent"):
            await _reset_for_new_intent(phone, new_intent, version)
            next_state = "budget" if new_intent == "buy" else "rent_budget"
            question = get_question(next_state)
            await send_message(phone, f"Welcome back! Let's start fresh. 🔄\n{question}")
            return
        await send_message(phone, "Thanks for reaching out! Our broker will contact you soon. 🙏")
        return

    # ── handle opted-out user messaging again ─────────────────────
    if conversation.get("opted_out"):
        await Database.update_conversation(phone, {
            "state": "intent",
            "intent": None,
            "completed": False,
            "opted_out": False,
            "reminders_sent": 0,
            "broker_notified": False,
            "score": None,
            "score_label": None,
            "data": Database._empty_data(),
        })
        await send_message(phone, get_question("intent"))
        return

    # ── LLM extraction ────────────────────────────────────────────
    extraction = await extract_data(current_state, intent, message_body)
    extracted_data = extraction.get("data", {})

    # ── handle edge cases (priority order) ────────────────────────

    # 1. Intent change mid-flow
    if extraction.get("intent_change") in ("buy", "rent"):
        new_intent = extraction["intent_change"]
        # Also store any data that came with the change
        if extracted_data:
            conv_data.update({k: v for k, v in extracted_data.items() if v is not None})
        await _reset_for_new_intent(phone, new_intent, version, preserved_data=conv_data)
        next_state = get_next_unsatisfied_state(new_intent, conv_data)
        if next_state is None:
            await _complete_conversation(phone, new_intent, conv_data, version)
        else:
            question = get_question(next_state)
            await send_message(phone, f"Switching to **{new_intent}**! 👍\n{question}")
        return

    # 2. Intent ambiguous [EC-17]
    if extraction.get("intent_ambiguous") and current_state == "intent":
        await send_message(
            phone,
            "Could you pick one — are you looking to **buy** or **rent**? 😊",
        )
        return

    # 3. Complex query → escalate
    if extraction.get("needs_escalation"):
        question = get_question(current_state)
        await send_message(
            phone,
            f"That's best answered by our broker — I'll have them reach out. 📞\n\n"
            f"Meanwhile, {question}",
        )
        return

    # 4. Off-topic
    if extraction.get("off_topic"):
        off_topic_reply = extraction.get("off_topic_response") or "I hear you!"
        question = get_question(current_state)
        await send_message(phone, f"{off_topic_reply}\n\n{question}")
        return

    # 5. Clarification needed AND no useful data extracted
    if extraction.get("clarification_needed") and not extracted_data:
        clarification = extraction.get("clarification_message") or get_question(current_state)
        await send_message(phone, clarification)
        return

    # ── no data extracted at all ──────────────────────────────────
    if not extracted_data:
        await send_message(phone, f"I didn't catch that. {get_question(current_state)}")
        return

    # ── store extracted data ──────────────────────────────────────
    # [EC-03] Store ALL extracted data, not just current state's field
    # [EC-09] Allow updating previous answers
    for key, value in extracted_data.items():
        if value is not None:
            conv_data[key] = value

    # Set intent if this is the intent state
    if current_state == "intent" and extracted_data.get("intent") in ("buy", "rent"):
        intent = extracted_data["intent"]

    if intent is None:
        # Still no intent — ask again
        await send_message(phone, get_question("intent"))
        return

    # ── determine next state [EC-03] ──────────────────────────────
    next_state = get_next_unsatisfied_state(intent, conv_data)

    # ── update database ───────────────────────────────────────────
    update = {
        "intent": intent,
        "data": conv_data,
    }

    if next_state is None:
        # All required data collected → complete
        await Database.update_conversation(phone, update, version)
        await _complete_conversation(phone, intent, conv_data, version + 1)
    else:
        update["state"] = next_state
        await Database.update_conversation(phone, update, version)

        # Build response — acknowledge + next question
        # [EC-03] If we jumped ahead, acknowledge all the data we got
        acknowledged = _build_acknowledgment(current_state, next_state, extracted_data, intent)
        question = get_question(next_state)
        await send_message(phone, f"{acknowledged} {question}")


# ── helpers ────────────────────────────────────────────────────────

def _build_acknowledgment(
    current_state: str,
    next_state: str,
    extracted_data: dict,
    intent: str,
) -> str:
    """
    [EC-03] Build a contextual acknowledgment.
    If user gave multiple answers, acknowledge that we captured them all.
    """
    # Count how many new fields we extracted beyond the current state
    fields_by_state = {
        "intent": {"intent"},
        "budget": {"budget_min", "budget_max"},
        "rent_budget": {"rent_min", "rent_max"},
        "location": {"location"},
        "timeline": {"timeline", "timeline_days"},
        "loan_status": {"loan_status"},
        "move_in_timeline": {"move_in_timeline", "move_in_days"},
        "property_type": {"property_type"},
    }

    current_fields = fields_by_state.get(current_state, set())
    extra_fields = set(extracted_data.keys()) - current_fields - {"intent"}
    extra_fields = {f for f in extra_fields if extracted_data.get(f) is not None}

    if len(extra_fields) >= 2:
        return "Got all that, thanks! 👍"
    elif extra_fields:
        return "Noted! 👍"
    else:
        return "Got it 👍"


async def _reset_for_new_intent(
    phone: str,
    new_intent: str,
    version: int,
    preserved_data: dict | None = None,
):
    """Reset conversation data for a new intent."""
    new_data = Database._empty_data()

    # Keep location if already provided (common to both flows)
    if preserved_data:
        if preserved_data.get("location"):
            new_data["location"] = preserved_data["location"]
        # Also keep any data relevant to the new intent
        if new_intent == "buy":
            for k in ("budget_min", "budget_max", "timeline", "timeline_days", "loan_status"):
                if preserved_data.get(k):
                    new_data[k] = preserved_data[k]
        else:
            for k in ("rent_min", "rent_max", "move_in_timeline", "move_in_days", "property_type"):
                if preserved_data.get(k):
                    new_data[k] = preserved_data[k]

    next_state = get_next_unsatisfied_state(new_intent, new_data)

    await Database.update_conversation(phone, {
        "intent": new_intent,
        "state": next_state or "complete",
        "data": new_data,
        "score": None,
        "score_label": None,
        "completed": False,
        "broker_notified": False,
        "reminders_sent": 0,
    }, version)


async def _complete_conversation(
    phone: str,
    intent: str,
    data: dict,
    version: int,
):
    """Score the lead, generate summary, and notify broker."""

    # [EC-10] Check minimum data before marking complete
    min_met, missing = minimum_data_met(intent, data)
    if not min_met:
        # Not enough data — ask for the missing piece instead of completing
        next_state = get_next_unsatisfied_state(intent, data)
        if next_state:
            await Database.update_conversation(phone, {
                "state": next_state,
                "intent": intent,
                "data": data,
            }, version)
            question = get_question(next_state)
            await send_message(
                phone,
                f"Almost there! I still need your {missing}. {question}",
            )
            return

    # Score
    if intent == "buy":
        score, label = score_buy_lead(data)
    else:
        score, label = score_rent_lead(data)

    await Database.update_conversation(phone, {
        "state": "complete",
        "score": score,
        "score_label": label,
        "completed": True,
        "intent": intent,
        "data": data,
    }, version)

    summary = _generate_summary(intent, data, score, label)
    await send_message(
        phone,
        f"Thanks for sharing! Here's your summary:\n\n{summary}\n\n"
        f"Our broker will reach out shortly. 🏠",
    )
    await _notify_broker(phone, intent, data, score, label)


def _format_lakhs(val: float) -> str:
    if val >= 100:
        cr = val / 100
        if cr == int(cr):
            return f"₹{int(cr)}Cr"
        return f"₹{cr:.1f}Cr"
    return f"₹{int(val)}L"


def _format_budget(budget_min, budget_max) -> str:
    if budget_min and budget_max:
        if budget_min == budget_max:
            return _format_lakhs(budget_min)
        return f"{_format_lakhs(budget_min)}–{_format_lakhs(budget_max)}"
    if budget_min:
        return f"{_format_lakhs(budget_min)}+"
    if budget_max:
        return f"Up to {_format_lakhs(budget_max)}"
    return "N/A"


def _format_rent(rent_min, rent_max) -> str:
    if rent_min and rent_max:
        if rent_min == rent_max:
            return f"₹{int(rent_min)}k/mo"
        return f"₹{int(rent_min)}k–₹{int(rent_max)}k/mo"
    if rent_min:
        return f"₹{int(rent_min)}k+/mo"
    if rent_max:
        return f"Up to ₹{int(rent_max)}k/mo"
    return "N/A"


def _generate_summary(intent: str, data: dict, score: int, label: str) -> str:
    if intent == "buy":
        return (
            f"🎯 Intent: Buy\n"
            f"💰 Budget: {_format_budget(data.get('budget_min'), data.get('budget_max'))}\n"
            f"📍 Location: {data.get('location', 'N/A')}\n"
            f"📅 Timeline: {data.get('timeline', 'N/A')}\n"
            f"🏦 Loan: {(data.get('loan_status') or 'N/A').title()}\n"
            f"🔥 Score: {score} ({label})"
        )
    return (
        f"🎯 Intent: Rent\n"
        f"💰 Rent: {_format_rent(data.get('rent_min'), data.get('rent_max'))}\n"
        f"📍 Location: {data.get('location', 'N/A')}\n"
        f"📅 Move-in: {data.get('move_in_timeline', 'N/A')}\n"
        f"🏠 Type: {data.get('property_type', 'N/A')}\n"
        f"🔥 Score: {score} ({label})"
    )


async def _notify_broker(phone: str, intent: str, data: dict, score: int, label: str):
    summary = _generate_summary(intent, data, score, label)
    broker_msg = f"🏠 NEW LEAD ({label})\n\n📞 Phone: {phone}\n\n{summary}"

    # Always log to console
    print(f"\n{'='*60}")
    print(broker_msg)
    print(f"{'='*60}\n")

    # HTTP webhook
    if settings.BROKER_WEBHOOK_URL:
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                await client.post(settings.BROKER_WEBHOOK_URL, json={
                    "phone": phone,
                    "intent": intent,
                    "data": data,
                    "score": score,
                    "label": label,
                    "summary": summary,
                })
        except Exception as e:
            logger.error(f"Broker webhook error: {e}")

    # WhatsApp to broker
    if settings.BROKER_PHONE:
        await send_message(settings.BROKER_PHONE, broker_msg)

    await Database.update_conversation(phone, {"broker_notified": True})