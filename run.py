"""
Single entry point for the WhatsApp Lead Qualifier.

- DRY_RUN=true  → Interactive terminal chat (no Twilio, no curl)
- DRY_RUN=false → Production Uvicorn server (connected to Twilio)
"""

import asyncio
import sys
import uvicorn

from app.config import settings
from app.database import Database
from app.orchestrator import handle_message


async def interactive_chat():
    """Run an interactive terminal chat for local testing."""
    print("\n" + "=" * 60)
    print("🛠️  LOCAL TESTING MODE (DRY_RUN=true)")
    print("=" * 60)
    print("Chat with the bot directly in this terminal.")
    print("")
    print("Commands:")
    print("  reset   - Clear conversation and start over")
    print("  phone   - Change the test phone number")
    print("  quit    - Exit the program")
    print("=" * 60 + "\n")

    # Connect to DB
    await Database.connect()

    if not Database.is_connected():
        print("❌ MongoDB not connected! Check your .env file.")
        print("   Make sure MONGO_URI is correct and your IP is whitelisted on Atlas.")
        await Database.close()
        sys.exit(1)

    print("✅ MongoDB connected!\n")

    # Default test phone number
    phone = "+919999999999"

    while True:
        try:
            user_input = input(f"👤 YOU ({phone}): ").strip()
        except (EOFError, KeyboardInterrupt):
            break

        if not user_input:
            continue

        # Handle commands
        if user_input.lower() in ("quit", "exit", "q"):
            break

        if user_input.lower() == "reset":
            await Database.db.conversations.delete_one({"phone": phone})
            print("🔄 Conversation reset! Starting fresh.\n")
            continue

        if user_input.lower().startswith("phone"):
            parts = user_input.split(maxsplit=1)
            if len(parts) == 2:
                phone = parts[1].strip()
                print(f"📞 Phone number changed to: {phone}\n")
            else:
                print(f"📞 Current phone: {phone}")
                print("   Usage: phone +919876543210\n")
            continue

        # Process the message through the orchestrator
        try:
            await handle_message(phone, user_input)
        except Exception as e:
            print(f"\n❌ ERROR: {e}\n")

    await Database.close()
    print("\n👋 Bye!\n")


def run_production():
    """Run the production Uvicorn server with Twilio."""
    print("\n🚀 PRODUCTION MODE (DRY_RUN=false)")
    print("Starting Uvicorn server with Twilio integration...\n")

    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
    )


if __name__ == "__main__":
    if settings.DRY_RUN:
        asyncio.run(interactive_chat())
    else:
        run_production()