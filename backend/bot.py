"""
Owner-only Telegram bot for managing the Vidyalay Coaching Centre Study Portal.
No web admin login exists — everything is controlled through these commands.

Run as its own process (separate from the FastAPI web server, or in the same
process using asyncio.gather — see run_all.py):

    python bot.py

Commands:
    /add                      - add a new study material (guided flow)
    /delete <10-digit-id>     - remove a document
    /list                     - list all documents
    /stats                    - usage statistics
    /unlock <email|user_id>   - grant/extend 30-day access after payment
    /ban <email>              - block a user
    /unban <email>            - unblock a user
    /broadcast <message>      - message all registered users
"""
import asyncio
from datetime import datetime
from telethon import TelegramClient, events, Button
from telethon.sessions import StringSession

from config import (
    TELEGRAM_API_ID,
    TELEGRAM_API_HASH,
    TELEGRAM_STRING_SESSION,
    BOT_TOKEN,
    OWNER_CHAT_ID,
)
from database import documents_col, users_col, orders_col
from telegram_client import upload_pdf
from utils import generate_unique_doc_id, unlock_user, ban_user, unban_user

# Bot client (separate login from the string-session user client that streams files)
bot = TelegramClient("bot_session", TELEGRAM_API_ID, TELEGRAM_API_HASH)

# In-memory state machine for the /add conversation flow, keyed by chat id.
_add_flow_state: dict[int, dict] = {}


def _owner_only(func):
    async def wrapper(event):
        if event.chat_id != OWNER_CHAT_ID:
            return  # silently ignore non-owner senders
        return await func(event)
    return wrapper


# ---------------------------------------------------------------------------
# /add — guided multi-step flow: title -> category -> description -> PDF file
# ---------------------------------------------------------------------------

@bot.on(events.NewMessage(pattern="/add"))
@_owner_only
async def add_command(event):
    _add_flow_state[event.chat_id] = {"step": "title"}
    await event.respond("📘 Let's add a new study material.\n\nSend the **title** of the document.")


@bot.on(events.NewMessage())
@_owner_only
async def add_flow_router(event):
    state = _add_flow_state.get(event.chat_id)
    if not state:
        return  # not in an /add flow

    if event.text and event.text.startswith("/"):
        return  # let other command handlers take it

    step = state["step"]

    if step == "title":
        state["title"] = event.text.strip()
        state["step"] = "category"
        from config import CATEGORIES
        options = "\n".join(f"{i+1}. {c}" for i, c in enumerate(CATEGORIES))
        await event.respond(f"📂 Choose a category (reply with the number):\n\n{options}")

    elif step == "category":
        from config import CATEGORIES
        try:
            idx = int(event.text.strip()) - 1
            state["category"] = CATEGORIES[idx]
        except (ValueError, IndexError):
            await event.respond("Please reply with a valid category number.")
            return
        state["step"] = "description"
        await event.respond("📝 Send a short description of this material.")

    elif step == "description":
        state["description"] = event.text.strip()
        state["step"] = "file"
        await event.respond("📎 Now send the PDF file itself.")

    elif step == "file":
        if not event.document:
            await event.respond("Please send the file as a PDF document (not an image).")
            return
        await event.respond("⏳ Uploading to secure storage, please wait...")

        file_bytes = await event.download_media(bytes)
        filename = event.document.attributes[0].file_name if event.document.attributes else "material.pdf"
        size_mb = round(len(file_bytes) / (1024 * 1024), 2)

        upload_result = await upload_pdf(file_bytes, filename, caption=state["title"])

        doc_id = await generate_unique_doc_id()
        await documents_col.insert_one({
            "doc_id": doc_id,
            "title": state["title"],
            "category": state["category"],
            "description": state["description"],
            "telegram_message_id": upload_result["message_id"],
            "telegram_file_unique_id": upload_result["telegram_file_unique_id"],
            "file_size_mb": size_mb,
            "upload_date": datetime.utcnow(),
            "download_count": 0,
        })

        _add_flow_state.pop(event.chat_id, None)
        await event.respond(
            f"✅ Added successfully!\n\n"
            f"**Title:** {state['title']}\n"
            f"**Category:** {state['category']}\n"
            f"**ID:** `{doc_id}`\n"
            f"**Size:** {size_mb} MB"
        )


# ---------------------------------------------------------------------------
# /delete <10-digit-id>
# ---------------------------------------------------------------------------

@bot.on(events.NewMessage(pattern=r"/delete (\d{10})"))
@_owner_only
async def delete_command(event):
    doc_id = event.pattern_match.group(1)
    doc = await documents_col.find_one({"doc_id": doc_id})
    if not doc:
        await event.respond(f"❌ No document found with ID {doc_id}")
        return

    from telegram_client import delete_pdf
    try:
        await delete_pdf(doc["telegram_message_id"])
    except Exception as e:
        print(f"[WARN] Could not delete underlying file: {e}")

    await documents_col.delete_one({"doc_id": doc_id})
    await event.respond(f"🗑️ Deleted document {doc_id} ({doc['title']})")


# ---------------------------------------------------------------------------
# /list
# ---------------------------------------------------------------------------

@bot.on(events.NewMessage(pattern="/list"))
@_owner_only
async def list_command(event):
    cursor = documents_col.find().sort("upload_date", -1).limit(50)
    docs = await cursor.to_list(length=50)
    if not docs:
        await event.respond("No documents uploaded yet.")
        return

    lines = [f"`{d['doc_id']}` — {d['title']} ({d['category']}) — {d['download_count']} downloads" for d in docs]
    text = "📋 **Current Documents:**\n\n" + "\n".join(lines)
    # Telegram messages cap ~4096 chars; chunk if needed
    for i in range(0, len(text), 4000):
        await event.respond(text[i:i + 4000])


# ---------------------------------------------------------------------------
# /stats
# ---------------------------------------------------------------------------

@bot.on(events.NewMessage(pattern="/stats"))
@_owner_only
async def stats_command(event):
    total_docs = await documents_col.count_documents({})
    pipeline = [{"$group": {"_id": None, "total": {"$sum": "$download_count"}}}]
    agg = await documents_col.aggregate(pipeline).to_list(length=1)
    total_downloads = agg[0]["total"] if agg else 0

    total_users = await users_col.count_documents({})
    active_subs = await users_col.count_documents({"subscription_expiry": {"$gt": datetime.utcnow()}})
    pending_orders = await orders_col.count_documents({"status": "pending_verification"})

    await event.respond(
        f"📊 **Portal Stats**\n\n"
        f"Total materials: {total_docs}\n"
        f"Total downloads: {total_downloads}\n"
        f"Registered users: {total_users}\n"
        f"Active subscribers: {active_subs}\n"
        f"Pending payment verifications: {pending_orders}"
    )


# ---------------------------------------------------------------------------
# /unlock <email or user-id>
# ---------------------------------------------------------------------------

@bot.on(events.NewMessage(pattern=r"/unlock (\S+)"))
@_owner_only
async def unlock_command(event):
    identifier = event.pattern_match.group(1)
    expiry = await unlock_user(identifier, days=30)
    await event.respond(f"🔓 Unlocked access for `{identifier}` until {expiry.strftime('%Y-%m-%d')}")


# ---------------------------------------------------------------------------
# /ban and /unban
# ---------------------------------------------------------------------------

@bot.on(events.NewMessage(pattern=r"/ban (\S+)"))
@_owner_only
async def ban_command(event):
    email = event.pattern_match.group(1)
    await ban_user(email)
    await event.respond(f"🚫 Banned {email}")


@bot.on(events.NewMessage(pattern=r"/unban (\S+)"))
@_owner_only
async def unban_command(event):
    email = event.pattern_match.group(1)
    await unban_user(email)
    await event.respond(f"✅ Unbanned {email}")


# ---------------------------------------------------------------------------
# /broadcast <message>
# ---------------------------------------------------------------------------

@bot.on(events.NewMessage(pattern=r"/broadcast (.+)", func=lambda e: e.text.split()[0] == "/broadcast"))
@_owner_only
async def broadcast_command(event):
    message = event.pattern_match.group(1)
    cursor = users_col.find({"telegram_user_id": {"$exists": True}})
    users = await cursor.to_list(length=None)

    sent = 0
    for user in users:
        try:
            await bot.send_message(user["telegram_user_id"], f"📢 {message}")
            sent += 1
            await asyncio.sleep(0.05)  # avoid flood limits
        except Exception:
            continue

    await event.respond(f"📢 Broadcast sent to {sent} user(s).")


# ---------------------------------------------------------------------------
# Owner notification helper (called from the FastAPI order endpoint)
# ---------------------------------------------------------------------------

async def notify_owner_of_order(order_doc: dict):
    if not bot.is_connected():
        await bot.connect()
    text = (
        f"💰 **New payment intent**\n\n"
        f"Email: {order_doc.get('email', 'N/A')}\n"
        f"Doc ID: {order_doc.get('doc_id', 'N/A')}\n"
        f"Amount: ₹{order_doc.get('amount_inr')}\n\n"
        f"Verify the UPI payment, then run:\n"
        f"`/unlock {order_doc.get('email', '')}`"
    )
    await bot.send_message(OWNER_CHAT_ID, text)


async def main():
    await bot.start(bot_token=BOT_TOKEN)
    print("🤖 Vidyalay admin bot is running...")
    await bot.run_until_disconnected()


if __name__ == "__main__":
    asyncio.run(main())
