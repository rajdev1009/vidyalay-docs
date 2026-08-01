"""
Single shared Telethon client authenticated via BOT_TOKEN.

Both bot.py (admin commands) and telegram_client.py (storage upload/download
in bot-token fallback mode, i.e. when TELEGRAM_STRING_SESSION is not set)
import THIS client instead of each creating their own. Logging in with a
bot token twice, back-to-back, is what triggers Telegram's FloodWaitError
on ImportBotAuthorizationRequest — sharing one client means the bot only
logs in once per process start, no matter how many places use it.
"""
import asyncio
from telethon import TelegramClient

from config import TELEGRAM_API_ID, TELEGRAM_API_HASH, BOT_TOKEN

bot = TelegramClient("bot_session", TELEGRAM_API_ID, TELEGRAM_API_HASH)

_lock = asyncio.Lock()
_started = False


async def start_bot_client():
    """Idempotent + race-safe: only the first caller actually logs in."""
    global _started
    async with _lock:
        if _started and bot.is_connected():
            return
        await bot.start(bot_token=BOT_TOKEN)
        _started = True
      
