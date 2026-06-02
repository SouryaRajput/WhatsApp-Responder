"""
LLM data extraction via OpenRouter with Fast Path optimization.
"""

import json
import logging
import asyncio
from openai import AsyncOpenAI
from app.config import settings
from app.security import detect_injection
from app.fast_path import try_local_extract

logger = logging.getLogger(__name__)

client = AsyncOpenAI(
    base_url=settings.OPENROUTER_BASE_URL,
    api_key=settings.OPENROUTER_API_KEY,
    default_headers={
        "HTTP-Referer": settings.APP_URL,
        "X-Title": settings.APP_NAME,
    },
    timeout=settings.OPENROUTER_TIMEOUT,
)

UNIFIED_SCHEMA = """{
  "intent_change": null, "intent_ambiguous": false,
  "off_topic": false, "off_topic_response": null,
  "needs_escalation": false, "escalation_reason": null,
  "clarification_needed": false, "clarification_message": null,
  "data": {
    "intent": "buy or rent or null",
    "budget_min": "number or null (LAKHS)", "budget_max": "number or null (LAKHS)",
    "rent_min": "number or null (THOUSANDS/mo)", "rent_max": "number or null (THOUSANDS/mo)",
    "location": "string or null",
    "timeline": "string or null", "timeline_days": "number or null",
    "loan_status": "yes/no/null",
    "move_in_timeline": "string or null", "move_in_days": "number or null",
    "property_type": "string or null"
  }
}"""

# OPTIMIZED: Much shorter prompt to reduce token processing time
SYSTEM_PROMPT = """Extract real estate lead data. State: {state}, Intent: {intent}, Message: "{message}"

Rules:
1. Extract ALL data present (budget, location, etc), not just current state.
2. Conversions: Budget→LAKHS (1Cr=100L, "around 80L"→75-85), Rent→THOUSANDS/mo ("15k"→15), Timeline→days (immediately=0, 1 month=30, exploring=365).
3. intent_change: new intent if changed. intent_ambiguous: if unclear. off_topic: if completely unrelated to real estate. needs_escalation: legal/pricing disputes. clarification_needed: if too vague.
4. Do NOT extract rent data for buy intent, or buy data for rent intent.
Return ONLY valid JSON matching this schema: {schema}"""

FALLBACK_RESPONSE = {
    "intent_change": None, "intent_ambiguous": False,
    "off_topic": False, "off_topic_response": None,
    "needs_escalation": False, "escalation_reason": None,
    "clarification_needed": True,
    "clarification_message": "I didn't quite get that. Could you please rephrase? 🤔",
    "data": {},
}


def _validate_and_coerce_data(data: dict) -> dict:
    numeric_fields = {
        "budget_min": (0, 100000), "budget_max": (0, 100000),
        "rent_min": (0, 10000), "rent_max": (0, 10000),
        "timeline_days": (0, 730), "move_in_days": (0, 730),
    }
    string_fields = {"location", "timeline", "move_in_timeline", "property_type"}
    enum_fields = {"intent": ("buy", "rent"), "loan_status": ("yes", "no")}

    cleaned = {}
    for key, value in data.items():
        if value is None: continue
        if key in numeric_fields:
            try: val = float(value)
            except: continue
            lo, hi = numeric_fields[key]
            if val < lo or val > hi: continue
            cleaned[key] = int(val) if val == int(val) else val
        elif key in string_fields:
            if not isinstance(value, str): value = str(value)
            value = value.strip()[:200]
            if value: cleaned[key] = value
        elif key in enum_fields:
            allowed = enum_fields[key]
            if isinstance(value, str) and value.lower() in allowed:
                cleaned[key] = value.lower()
    return cleaned


async def extract_data(state: str, intent: str | None, message: str) -> dict:
    # ── FAST PATH: Try local regex extraction first ───────────────
    local_data = try_local_extract(state, message)
    if local_data is not None:
        logger.info(f"⚡ Fast path hit for state '{state}': {local_data}")
        return {
            "intent_change": None, "intent_ambiguous": False,
            "off_topic": False, "off_topic_response": None,
            "needs_escalation": False, "escalation_reason": None,
            "clarification_needed": False, "clarification_message": None,
            "data": _validate_and_coerce_data(local_data),
        }

    # ── SLOW PATH: Use LLM ───────────────────────────────────────
    if detect_injection(message):
        logger.warning(f"Possible prompt injection detected: {message[:100]}")

    prompt = SYSTEM_PROMPT.format(state=state, intent=intent or "unknown", message=message, schema=UNIFIED_SCHEMA)

    last_error = None
    for attempt in range(settings.OPENROUTER_MAX_RETRIES + 1):
        try:
            response = await client.chat.completions.create(
                model=settings.OPENROUTER_MODEL,
                messages=[
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": message},
                ],
                response_format={"type": "json_object"},
                temperature=0.0,
                max_tokens=300, # Reduced from 400
            )

            raw = response.choices[0].message.content
            result = json.loads(raw)

            result.setdefault("intent_change", None)
            result.setdefault("intent_ambiguous", False)
            result.setdefault("off_topic", False)
            result.setdefault("off_topic_response", None)
            result.setdefault("needs_escalation", False)
            result.setdefault("escalation_reason", None)
            result.setdefault("clarification_needed", False)
            result.setdefault("clarification_message", None)
            result.setdefault("data", {})

            result["data"] = _validate_and_coerce_data(result["data"])

            extracted_intent = result["data"].get("intent")
            effective_intent = result.get("intent_change") or extracted_intent or intent
            if effective_intent == "buy":
                for k in ("rent_min", "rent_max", "move_in_timeline", "move_in_days"): result["data"].pop(k, None)
            elif effective_intent == "rent":
                for k in ("budget_min", "budget_max", "timeline", "timeline_days", "loan_status"): result["data"].pop(k, None)

            if result["data"].get("budget_min") and result["data"].get("budget_max"):
                if result["data"]["budget_min"] > result["data"]["budget_max"]:
                    result["data"]["budget_min"], result["data"]["budget_max"] = result["data"]["budget_max"], result["data"]["budget_min"]
            if result["data"].get("rent_min") and result["data"].get("rent_max"):
                if result["data"]["rent_min"] > result["data"]["rent_max"]:
                    result["data"]["rent_min"], result["data"]["rent_max"] = result["data"]["rent_max"], result["data"]["rent_min"]

            return result

        except json.JSONDecodeError as e:
            logger.warning(f"LLM returned invalid JSON (attempt {attempt+1}): {e}")
            last_error = e
        except Exception as e:
            logger.error(f"OpenRouter extraction error (attempt {attempt+1}): {e}")
            last_error = e

        if attempt < settings.OPENROUTER_MAX_RETRIES:
            delay = settings.OPENROUTER_RETRY_BASE_DELAY * (2 ** attempt)
            logger.info(f"Retrying OpenRouter call in {delay}s…")
            await asyncio.sleep(delay)

    logger.error(f"OpenRouter extraction failed: {last_error}")
    return {**FALLBACK_RESPONSE}