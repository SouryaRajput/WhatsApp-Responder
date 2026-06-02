import sys
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # ── MongoDB ───────────────────────────────────────────────────
    MONGO_URI: str = ""
    DB_NAME: str = "lead_qualifier"

    # ── Twilio ────────────────────────────────────────────────────
    TWILIO_ACCOUNT_SID: str = ""
    TWILIO_AUTH_TOKEN: str = ""
    TWILIO_WHATSAPP_NUMBER: str = ""  # e.g. "+14155238886"

    # ── OpenRouter ────────────────────────────────────────────────
    OPENROUTER_API_KEY: str = ""
    OPENROUTER_MODEL: str = "openai/gpt-4o-mini"
    OPENROUTER_BASE_URL: str = "https://openrouter.ai/api/v1"
    OPENROUTER_TIMEOUT: int = 8
    OPENROUTER_MAX_RETRIES: int = 1
    OPENROUTER_RETRY_BASE_DELAY: float = 1.0

    # ── App identity (sent to OpenRouter) ─────────────────────────
    APP_NAME: str = "WhatsApp Lead Qualifier"
    APP_URL: str = "https://github.com/whatsapp-lead-qualifier"

    # ── Broker notification ───────────────────────────────────────
    BROKER_WEBHOOK_URL: str = ""
    BROKER_PHONE: str = ""

    # ── Follow-up timing ──────────────────────────────────────────
    REMINDER_HOURS: int = 24
    FOLLOWUP_HOURS: int = 72
    MAX_FOLLOWUPS: int = 2

    # ── Rate limiting ─────────────────────────────────────────────
    RATE_LIMIT_PER_MINUTE: int = 10
    RATE_LIMIT_PER_DAY: int = 50

    # ── Conversation limits ───────────────────────────────────────
    CONVERSATION_EXPIRY_DAYS: int = 30
    MAX_USER_MESSAGE_LENGTH: int = 500
    MAX_WHATSAPP_MESSAGE_LENGTH: int = 4096

    # ── Modes ─────────────────────────────────────────────────────
    DRY_RUN: bool = False
    ENABLE_TEST_ENDPOINT: bool = True

    # ── Lock cleanup ──────────────────────────────────────────────
    LOCK_TTL_SECONDS: int = 300

    class Config:
        env_file = ".env"

    def validate_critical(self) -> None:
        errors: list[str] = []
        if not self.OPENROUTER_API_KEY:
            errors.append("OPENROUTER_API_KEY is required")
        if not self.DRY_RUN:
            if not self.TWILIO_ACCOUNT_SID:
                errors.append("TWILIO_ACCOUNT_SID is required when DRY_RUN=false")
            if not self.TWILIO_AUTH_TOKEN:
                errors.append("TWILIO_AUTH_TOKEN is required when DRY_RUN=false")
            if not self.TWILIO_WHATSAPP_NUMBER:
                errors.append("TWILIO_WHATSAPP_NUMBER is required when DRY_RUN=false")
        if errors:
            print("❌ Configuration errors:")
            for e in errors:
                print(f"  - {e}")
            sys.exit(1)


settings = Settings()
settings.validate_critical()
