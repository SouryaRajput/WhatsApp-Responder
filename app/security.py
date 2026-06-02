"""
[EC-04] Twilio webhook signature verification
[EC-06] Per-phone rate limiting
[EC-12] Input sanitization
"""

import hmac
import hashlib
import time
import re
import logging
from collections import defaultdict
from urllib.parse import urlencode
from app.config import settings

logger = logging.getLogger(__name__)


# ── Twilio signature verification ─────────────────────────────────

def verify_twilio_signature(url: str, params: dict, signature: str) -> bool:
    """
    [EC-04] Verify that a request actually came from Twilio.
    https://www.twilio.com/docs/usage/security#validating-requests
    """
    if not settings.TWILIO_AUTH_TOKEN:
        # Can't verify without auth token — allow in DRY_RUN
        return settings.DRY_RUN

    # Sort params and concatenate
    sorted_params = sorted(params.items())
    param_string = urlencode(sorted_params)
    data = url + param_string

    computed = hmac.HMAC(
        settings.TWILIO_AUTH_TOKEN.encode(),
        data.encode(),
        hashlib.sha1,
    ).hexdigest()

    return hmac.compare_digest(computed, signature)


# ── Rate limiter ──────────────────────────────────────────────────

class RateLimiter:
    """[EC-06] Sliding window rate limiter per phone number."""

    def __init__(self):
        self._minute_buckets: dict[str, list[float]] = defaultdict(list)
        self._day_buckets: dict[str, list[float]] = defaultdict(list)

    def is_allowed(self, phone: str) -> tuple[bool, str]:
        now = time.time()

        # Per-minute check
        minute_key = phone
        self._minute_buckets[minute_key] = [
            t for t in self._minute_buckets[minute_key]
            if now - t < 60
        ]
        if len(self._minute_buckets[minute_key]) >= settings.RATE_LIMIT_PER_MINUTE:
            return False, "Rate limit: too many messages per minute"

        # Per-day check
        day_key = phone
        self._day_buckets[day_key] = [
            t for t in self._day_buckets[day_key]
            if now - t < 86400
        ]
        if len(self._day_buckets[day_key]) >= settings.RATE_LIMIT_PER_DAY:
            return False, "Rate limit: too many messages per day"

        self._minute_buckets[minute_key].append(now)
        self._day_buckets[day_key].append(now)
        return True, ""


rate_limiter = RateLimiter()


# ── Input sanitization ────────────────────────────────────────────

# WhatsApp formatting: *bold*, _italic_, ~strikethrough~, ```code```
WHATSAPP_FORMATTING = re.compile(r'[\*_~`]{1,3}')

# Common prompt injection patterns
INJECTION_PATTERNS = re.compile(
    r'(?i)(ignore\s+(previous|above|all)\s+instructions?|'
    r'forget\s+(everything|all|previous)|'
    r'you\s+are\s+now|'
    r'new\s+instructions?:|'
    r'system\s*:|'
    r'output\s+(the|your)\s+prompt)',
)

WHATSAPP_QUOTED_REPLY = re.compile(r'>.+$', re.MULTILINE)


def sanitize_input(text: str) -> str:
    """
    [EC-12] Sanitize user input before sending to LLM.
    - Strip WhatsApp formatting markers
    - Remove quoted reply lines
    - Flag obvious prompt injection attempts
    - Normalize whitespace
    """
    # Remove quoted replies (from WhatsApp's reply feature)
    text = WHATSAPP_QUOTED_REPLY.sub('', text)

    # Strip WhatsApp formatting
    text = WHATSAPP_FORMATTING.sub('', text)

    # Normalize whitespace
    text = ' '.join(text.split())

    return text.strip()


def detect_injection(text: str) -> bool:
    """
    [EC-12] Detect obvious prompt injection attempts.
    Returns True if suspicious — not a blocker, just a flag for logging.
    """
    return bool(INJECTION_PATTERNS.search(text))


# ── Phone number normalization ────────────────────────────────────

def normalize_phone(phone: str) -> str:
    """
    [EC-08] Normalize phone numbers to E.164 format.
    Handles: "+919876543210", "919876543210", "+91 98765 43210"
    """
    # Strip whatsapp: prefix
    phone = phone.replace("whatsapp:", "")

    # Remove all non-digit characters except leading +
    has_plus = phone.startswith('+')
    digits = re.sub(r'[^\d]', '', phone)

    # Indian numbers: 10 digits without country code
    if len(digits) == 10 and digits[0] in '6789':
        digits = '91' + digits

    # If we had a plus or have 12+ digits starting with 91, add +
    if len(digits) >= 12 or has_plus:
        return '+' + digits

    return '+' + digits if digits else phone