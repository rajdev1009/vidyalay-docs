"""
Small shared helpers.
"""
import random
from datetime import datetime, timedelta
from database import documents_col, users_col


async def generate_unique_doc_id() -> str:
    """Generate a random 10-digit numeric ID not already used in the DB."""
    while True:
        candidate = str(random.randint(1_000_000_000, 9_999_999_999))
        existing = await documents_col.find_one({"doc_id": candidate})
        if not existing:
            return candidate


async def is_user_active_subscriber(identifier: str) -> bool:
    """
    identifier can be an email or a telegram_user_id (as string).
    Returns True if subscription is currently valid.
    """
    query = {"$or": [{"email": identifier}]}
    if identifier.isdigit():
        query["$or"].append({"telegram_user_id": int(identifier)})

    user = await users_col.find_one(query)
    if not user:
        return False
    if user.get("is_banned"):
        return False
    expiry = user.get("subscription_expiry")
    if not expiry:
        return False
    return expiry > datetime.utcnow()


async def unlock_user(identifier: str, days: int = 30):
    """Grant/extend subscription access. Creates the user if needed."""
    new_expiry = datetime.utcnow() + timedelta(days=days)
    query = {"email": identifier} if not identifier.isdigit() else {"telegram_user_id": int(identifier)}

    existing = await users_col.find_one(query)
    if existing and existing.get("subscription_expiry") and existing["subscription_expiry"] > datetime.utcnow():
        new_expiry = existing["subscription_expiry"] + timedelta(days=days)

    update_doc = {
        "is_subscribed": True,
        "subscription_expiry": new_expiry,
        "is_banned": False,
    }
    if identifier.isdigit():
        update_doc["telegram_user_id"] = int(identifier)
    else:
        update_doc["email"] = identifier

    await users_col.update_one(query, {"$set": update_doc, "$setOnInsert": {"created_at": datetime.utcnow()}}, upsert=True)
    return new_expiry


async def ban_user(email: str):
    await users_col.update_one({"email": email}, {"$set": {"is_banned": True}}, upsert=True)


async def unban_user(email: str):
    await users_col.update_one({"email": email}, {"$set": {"is_banned": False}})
