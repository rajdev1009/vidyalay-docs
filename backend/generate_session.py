"""
Run this ONCE, locally on your own machine, to generate a Telethon string
session for TELEGRAM_STRING_SESSION. You will need your Telegram API ID and
API hash from https://my.telegram.org, plus your phone number and login code.

    python generate_session.py

Copy the printed string into your .env / Render environment variables.
Never share this string — it grants full access to the logged-in account.
"""
from telethon.sync import TelegramClient
from telethon.sessions import StringSession

api_id = int(input("Enter your TELEGRAM_API_ID: ").strip())
api_hash = input("Enter your TELEGRAM_API_HASH: ").strip()

with TelegramClient(StringSession(), api_id, api_hash) as client:
    session_string = client.session.save()
    print("\n✅ Your Telethon string session (copy this into TELEGRAM_STRING_SESSION):\n")
    print(session_string)
