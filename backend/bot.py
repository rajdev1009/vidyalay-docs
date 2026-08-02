"""
Owner-only Telegram bot for managing the Vidyalay Coaching Centre Study Portal.
No web admin login exists — everything is controlled through these commands.

Run as its own process (separate from the FastAPI web server, or in the same
process using asyncio.gather — see run_all.py):

    python bot.py

Commands:
    /start                    - greeting + quick instructions
    /add                      - add study material(s) (guided flow, supports
                                 sending multiple PDFs in a row under one
                                 category — finish with /done)
    (send a PDF directly, outside /add) - quick-add with a default category
    /done                     - finish an in-progress /add bulk session
    /delete <10-digit-id>     - remove a document
    /delete <email|unique-id> - remove a tracked user's record
    /list                     - list all documents
    /categories               - show category numbers (needed for /unlock)
    /stats                    - usage statistics
    /Dashboard                - full user activity list: who searched/opened/
                                 downloaded how many times, their email and
                                 unique ID (for users without email)
    /unlock <email|user_id> <category_no>  - grant/extend 30-day access to
                                              ONE category after payment
    /ban <email>              - block a user
    /unban <email>            - unblock a user
    /broadcast <message>      - message all registered users
"""
import asyncio
from datetime import datetime
from telethon import events, Button

from config import OWNER_CHAT_ID, CATEGORIES
from database import documents_col, users_col, orders_col
from telegram_client import upload_pdf
from utils import (
    generate_unique_doc_id,
    unlock_user_category,
    ban_user,
    unban_user,
    delete_user_by_identifier,
    get_all_users_summary,
)
from bot_client import bot, start_bot_client

# In-memory state machine for the /add conversation flow, keyed by chat id.
_add_flow_state: dict[int, dict] = {}


def _owner_only(func):
    async def wrapper(event):
        if event.chat_id != OWNER_CHAT_ID:
            return  # silently ignore non-owner senders
        return await func(event)
    return wrapper


# ---------------------------------------------------------------------------
# /start — greeting
# ---------------------------------------------------------------------------

@bot.on(events.NewMessage(pattern="/start"))
@_owner_only
async def start_command(event):
    await event.respond(
        "Hi, I'm Raj 👋\n\n"
        "Send me any PDF and I'll add it to the study portal ✨♥️\n\n"
        "Or use /add if you'd like to set the title, category, and description yourself."
    )


# ---------------------------------------------------------------------------
# Quick-add — send a PDF directly (outside /add) for a fast default upload
# ---------------------------------------------------------------------------

@bot.on(events.NewMessage())
@_owner_only
async def quick_pdf_handler(event):
    if event.chat_id in _add_flow_state:
        return  # an /add flow is in progress — let that handler take it
    if not event.document:
        return  # not a file message

    await event.respond("⏳ Got it! Uploading to secure storage, please wait...")

    try:
        file_bytes = await event.download_media(bytes)
        raw_filename = event.document.attributes[0].file_name if event.document.attributes else "material.pdf"
        size_mb = round(len(file_bytes) / (1024 * 1024), 2)

        name_without_ext = raw_filename.rsplit(".", 1)[0]
        auto_title = name_without_ext.replace("_", " ").replace("-", " ").strip() or "Untitled Material"
        default_category = "General Study Materials" if "General Study Materials" in CATEGORIES else CATEGORIES[0]

        upload_result = await upload_pdf(file_bytes, raw_filename, caption=auto_title)
        doc_id = await generate_unique_doc_id()
        await documents_col.insert_one({
            "doc_id": doc_id,
            "title": auto_title,
            "category": default_category,
            "description": "",
            "telegram_message_id": upload_result["message_id"],
            "telegram_file_unique_id": upload_result["telegram_file_unique_id"],
            "file_size_mb": size_mb,
            "upload_date": datetime.utcnow(),
            "download_count": 0,
        })

        await event.respond(
            f"✅ Added\n\n"
            f"**Title:** {auto_title}\n"
            f"**Category:** {default_category} _(default — use /add for full control)_\n"
            f"**ID:** `{doc_id}`\n"
            f"**Size:** {size_mb} MB"
        )
    except Exception as e:
        print(f"[ERROR] Quick upload failed: {e}")
        await event.respond(f"❌ Upload failed: `{e}`")


# ---------------------------------------------------------------------------
# /add — guided multi-step flow: title -> category -> description -> PDF file
# ---------------------------------------------------------------------------

@bot.on(events.NewMessage(pattern="/add"))
@_owner_only
async def add_command(event):
    _add_flow_state[event.chat_id] = {"step": "title"}
    await event.respond("📘 Let's add new study material(s).\n\nSend the **title** of the document.")


@bot.on(events.NewMessage())
@_owner_only
async def add_flow_router(event):
    state = _add_flow_state.get(event.chat_id)
    if not state:
        return  # not in an /add flow

    if event.text and event.text.startswith("/"):
        return  # let other command handlers (e.g. /done) take it

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
        state["count"] = 0
        await event.respond(
            "📎 Now send the PDF file(s).\n\n"
            "You can send as many PDFs as you want, one after another — "
            "each one is saved as its own document under this same category "
            "and description (title is taken from each file's name).\n\n"
            "When you're done, send /done to finish."
        )

    elif step == "file":
        if not event.document:
            await event.respond("Please send the file as a PDF document (not an image), or /done to finish.")
            return

        await event.respond("⏳ Uploading to secure storage, please wait...")

        try:
            file_bytes = await event.download_media(bytes)
            raw_filename = event.document.attributes[0].file_name if event.document.attributes else "material.pdf"
            size_mb = round(len(file_bytes) / (1024 * 1024), 2)

            # Auto-derive a readable title from the filename for this file,
            # falling back to the batch title if the filename is unusable.
            name_without_ext = raw_filename.rsplit(".", 1)[0]
            auto_title = name_without_ext.replace("_", " ").replace("-", " ").strip() or state["title"]

            upload_result = await upload_pdf(file_bytes, raw_filename, caption=auto_title)

            doc_id = await generate_unique_doc_id()
            await documents_col.insert_one({
                "doc_id": doc_id,
                "title": auto_title,
                "category": state["category"],
                "description": state["description"],
                "telegram_message_id": upload_result["message_id"],
                "telegram_file_unique_id": upload_result["telegram_file_unique_id"],
                "file_size_mb": size_mb,
                "upload_date": datetime.utcnow(),
                "download_count": 0,
            })

            state["count"] += 1
            await event.respond(
                f"✅ Added ({state['count']} so far)\n\n"
                f"**Title:** {auto_title}\n"
                f"**Category:** {state['category']}\n"
                f"**ID:** `{doc_id}`\n"
                f"**Size:** {size_mb} MB\n\n"
                f"Send the next PDF, or /done to finish."
            )
        except Exception as e:
            print(f"[ERROR] Upload failed: {e}")
            await event.respond(
                f"❌ Upload failed: `{e}`\n\n"
                f"Common cause: the bot isn't an admin of the storage channel "
                f"(needs Post + Delete permissions). Send the file again to retry, "
                f"or /done to stop here."
            )


# ---------------------------------------------------------------------------
# /done — finish an in-progress /add bulk-upload session
# ---------------------------------------------------------------------------

@bot.on(events.NewMessage(pattern="/done"))
@_owner_only
async def done_command(event):
    state = _add_flow_state.pop(event.chat_id, None)
    if not state or state.get("step") != "file":
        await event.respond("Nothing to finish — you're not in an active /add session.")
        return
    count = state.get("count", 0)
    await event.respond(f"🏁 Done. {count} document(s) added under **{state['category']}**.")


# ---------------------------------------------------------------------------
# /delete <10-digit-doc-id>  OR  /delete <user-email-or-unique-id>
# Documents are checked first (exact 10-digit match) so this never
# accidentally deletes the wrong kind of record.
# ---------------------------------------------------------------------------

@bot.on(events.NewMessage(pattern=r"/delete (\S+)"))
@_owner_only
async def delete_command(event):
    arg = event.pattern_match.group(1)

    if arg.isdigit() and len(arg) == 10:
        doc = await documents_col.find_one({"doc_id": arg})
        if doc:
            from telegram_client import delete_pdf
            try:
                await delete_pdf(doc["telegram_message_id"])
            except Exception as e:
                print(f"[WARN] Could not delete underlying file: {e}")
            await documents_col.delete_one({"doc_id": arg})
            await event.respond(f"🗑️ Deleted document {arg} ({doc['title']})")
            return

    deleted = await delete_user_by_identifier(arg)
    if deleted:
        await event.respond(f"🗑️ Deleted user record for `{arg}`")
    else:
        await event.respond(f"❌ No document or user found matching `{arg}`")


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
    active_subs = await users_col.count_documents({"category_access": {"$exists": True, "$ne": {}}})
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
# /Dashboard — full user activity list (downloads, opens, searches, IDs)
# ---------------------------------------------------------------------------

@bot.on(events.NewMessage(pattern="(?i)^/dashboard$"))
@_owner_only
async def dashboard_command(event):
    users = await get_all_users_summary(limit=100)
    if not users:
        await event.respond("No users tracked yet.")
        return

    lines = [f"👥 **User Dashboard** — {len(users)} tracked user(s)\n"]
    for u in users:
        label = u.get("email") or (str(u.get("telegram_user_id")) if u.get("telegram_user_id") else "no email")
        unique_id = u.get("unique_id") or "—"
        access_cats = ", ".join((u.get("category_access") or {}).keys()) or "none"
        banned = " 🚫BANNED" if u.get("is_banned") else ""
        lines.append(
            f"• {label}{banned}\n"
            f"   Unique ID: `{unique_id}`\n"
            f"   Downloads: {u.get('download_count', 0)} | Opens: {u.get('access_count', 0)} | Searches: {u.get('search_count', 0)}\n"
            f"   Access: {access_cats}\n"
        )
    text = "\n".join(lines)
    for i in range(0, len(text), 4000):
        await event.respond(text[i:i + 4000])


# ---------------------------------------------------------------------------
# /categories — quick reference so the owner knows the number to use in /unlock
# ---------------------------------------------------------------------------

@bot.on(events.NewMessage(pattern="/categories"))
@_owner_only
async def categories_command(event):
    options = "\n".join(f"{i+1}. {c}" for i, c in enumerate(CATEGORIES))
    await event.respond(f"📂 **Categories:**\n\n{options}\n\nUse the number with /unlock, e.g. `/unlock user@email.com 2`")


# ---------------------------------------------------------------------------
# /unlock <email or user-id> <category number>
# Grants access to ONE category only — the user needs a separate /unlock
# for each category they pay for.
# ---------------------------------------------------------------------------

@bot.on(events.NewMessage(pattern=r"/unlock (\S+) (\d+)"))
@_owner_only
async def unlock_command(event):
    identifier = event.pattern_match.group(1)
    cat_num = int(event.pattern_match.group(2))
    try:
        category = CATEGORIES[cat_num - 1]
    except IndexError:
        await event.respond("❌ Invalid category number. Send /categories to see the valid numbers.")
        return

    expiry = await unlock_user_category(identifier, category, days=30)
    await event.respond(
        f"🔓 Unlocked **{category}** access for `{identifier}` until {expiry.strftime('%Y-%m-%d')}\n\n"
        f"(This does NOT unlock other categories — repeat /unlock with a different number for those.)"
    )


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

    category = order_doc.get("category")
    if category and category in CATEGORIES:
        cat_num = CATEGORIES.index(category) + 1
        unlock_hint = f"`/unlock {order_doc.get('email', '')} {cat_num}`"
    else:
        unlock_hint = "`/unlock <email> <category_number>` (send /categories to see numbers)"

    text = (
        f"💰 **New payment intent**\n\n"
        f"Email: {order_doc.get('email', 'N/A')}\n"
        f"Doc ID: {order_doc.get('doc_id', 'N/A')}\n"
        f"Category: {category or 'N/A'}\n"
        f"Amount: ₹{order_doc.get('amount_inr')}\n\n"
        f"Verify the UPI payment, then run:\n"
        f"{unlock_hint}"
    )
    await bot.send_message(OWNER_CHAT_ID, text)


async def main():
    await start_bot_client()
    print("🤖 Vidyalay admin bot is running...")
    await bot.run_until_disconnected()


if __name__ == "__main__":
    asyncio.run(main())
    
