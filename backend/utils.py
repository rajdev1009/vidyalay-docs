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


def _lookup_query(identifier: str) -> dict:
    query = {"$or": [{"email": identifier}]}
    if identifier.isdigit():
        query["$or"].append({"telegram_user_id": int(identifier)})
    return query


async def is_user_active_for_category(identifier: str, category: str) -> bool:
    """
    Category-scoped access check. A user unlocked for "Assam Police" can
    NOT download "Railway Exams" material unless that category was
    separately unlocked too.
    """
    user = await users_col.find_one(_lookup_query(identifier))
    if not user or user.get("is_banned"):
        return False

    expiry = (user.get("category_access") or {}).get(category)
    if not expiry:
        return False
    return expiry > datetime.utcnow()


async def unlock_user_category(identifier: str, category: str, days: int = 30):
    """
    Grant/extend subscription access to ONE category only. Creates the user
    if needed. Existing access to other categories is untouched.
    """
    query = {"email": identifier} if not identifier.isdigit() else {"telegram_user_id": int(identifier)}

    existing = await users_col.find_one(query)
    current_expiry = (existing.get("category_access") or {}).get(category) if existing else None

    new_expiry = datetime.utcnow() + timedelta(days=days)
    if current_expiry and current_expiry > datetime.utcnow():
        new_expiry = current_expiry + timedelta(days=days)

    set_doc = {f"category_access.{category}": new_expiry, "is_banned": False}
    if identifier.isdigit():
        set_doc["telegram_user_id"] = int(identifier)
    else:
        set_doc["email"] = identifier

    await users_col.update_one(
        query,
        {"$set": set_doc, "$setOnInsert": {"created_at": datetime.utcnow()}},
        upsert=True,
    )
    return new_expiry


async def ban_user(email: str):
    await users_col.update_one({"email": email}, {"$set": {"is_banned": True}}, upsert=True)


async def unban_user(email: str):
    await users_col.update_one({"email": email}, {"$set": {"is_banned": False}})
    
