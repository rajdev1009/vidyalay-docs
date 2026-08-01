"""
Telegram client used to store and stream PDF files via a private Telegram
channel, instead of using disk space on Render.

Two modes, chosen automatically based on what's in .env:

  1. String-session mode (TELEGRAM_STRING_SESSION set) — logs in as a
     regular Telegram user account. Higher upload limits.

  2. Bot-token mode (TELEGRAM_STRING_SESSION left blank/removed) — reuses
     the SAME shared bot client from bot_client.py that the admin bot
     (bot.py) already logs in with. No session string needed, and no
     duplicate bot-token login (which is what triggers Telegram's
     FloodWaitError on ImportBotAuthorizationRequest). Bot must be an
     ADMIN of STORAGE_CHANNEL_ID for send/read/delete to work.
"""
import io
from telethon import TelegramClient
from telethon.sessions import StringSession

from config import (
    TELEGRAM_API_ID,
    TELEGRAM_API_HASH,
    TELEGRAM_STRING_SESSION,
    STORAGE_CHANNEL_ID,
)

USING_STRING_SESSION = bool(TELEGRAM_STRING_SESSION.strip())

if USING_STRING_SESSION:
    tg_client = TelegramClient(
        StringSession(TELEGRAM_STRING_SESSION),
        TELEGRAM_API_ID,
        TELEGRAM_API_HASH,
    )
else:
    # No string session given -> reuse the one shared bot-token client
    # instead of creating a second bot login (avoids double
    # ImportBotAuthorizationRequest -> FloodWaitError).
    from bot_client import bot as tg_client, start_bot_client


async def start_client():
    """Connect using the string session if provided, otherwise the shared bot client."""
    if tg_client.is_connected():
        return

    if USING_STRING_SESSION:
        await tg_client.connect()
        if not await tg_client.is_user_authorized():
            raise RuntimeError(
                "Telegram string session is invalid or expired. "
                "Regenerate it with generate_session.py, or remove "
                "TELEGRAM_STRING_SESSION from .env to use bot-token mode."
            )
    else:
        await start_bot_client()


async def stop_client():
    # In bot-token mode, tg_client IS the shared admin bot client — don't
    # disconnect it here, or the admin bot dies with it. Only disconnect
    # in string-session mode, where this client is dedicated to storage.
    if USING_STRING_SESSION and tg_client.is_connected():
        await tg_client.disconnect()


async def upload_pdf(file_bytes: bytes, filename: str, caption: str = "") -> dict:
    """
    Upload a PDF to the private storage channel.
    Returns the message_id and file_unique_id to store in MongoDB.
    """
    await start_client()
    message = await tg_client.send_file(
        STORAGE_CHANNEL_ID,
        file=io.BytesIO(file_bytes),
        attributes=None,
        file_name=filename,
        caption=caption,
        force_document=True,
    )
    file_unique_id = message.file.id if message.file else None
    return {
        "message_id": message.id,
        "telegram_file_unique_id": str(file_unique_id),
    }


async def stream_pdf_bytes(message_id: int) -> tuple[bytes, str]:
    """
    Fetch a stored PDF by its Telegram message ID and return raw bytes + filename.
    Used by the download/preview endpoints.
    """
    await start_client()
    message = await tg_client.get_messages(STORAGE_CHANNEL_ID, ids=message_id)
    if message is None or not message.file:
        raise FileNotFoundError(f"No file found for message_id={message_id}")

    buffer = io.BytesIO()
    await tg_client.download_media(message, file=buffer)
    buffer.seek(0)
    filename = message.file.name or f"document_{message_id}.pdf"
    return buffer.read(), filename


async def delete_pdf(message_id: int):
    """Delete the stored file from the private channel."""
    await start_client()
    await tg_client.delete_messages(STORAGE_CHANNEL_ID, [message_id])
  
