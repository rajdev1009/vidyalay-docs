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


# ---------------------------------------------------------------------------
# Visitor / user activity tracking (for the /Dashboard bot command)
# ---------------------------------------------------------------------------

def _tracking_query(visitor_id: str = None, email: str = None) -> dict:
    """
    Every visitor gets a unique_id generated client-side on first visit.
    If they later give an email (profile save / download), the same record
    is matched by email going forward so the two identities merge into one.
    """
    ors = []
    if email:
        ors.append({"email": email})
    if visitor_id:
        ors.append({"unique_id": visitor_id})
    return {"$or": ors} if ors else {"_id": None}  # matches nothing if neither given


async def record_user_activity(visitor_id: str = None, email: str = None, kind: str = "access"):
    """
    kind: "search" | "access" (preview) | "download"
    Increments the relevant counter and upserts the user record so it shows
    up in /Dashboard even before any category is ever unlocked.
    """
    if not visitor_id and not email:
        return

    counter_field = {
        "search": "search_count",
        "access": "access_count",
        "download": "download_count",
    }.get(kind, "access_count")

    query = _tracking_query(visitor_id, email)
    existing = await users_col.find_one(query)

    set_doc = {"last_active": datetime.utcnow()}
    if email:
        set_doc["email"] = email
    if visitor_id:
        set_doc["unique_id"] = visitor_id

    await users_col.update_one(
        query if existing else {"unique_id": visitor_id} if visitor_id else {"email": email},
        {
            "$set": set_doc,
            "$inc": {counter_field: 1},
            "$setOnInsert": {"created_at": datetime.utcnow(), "is_banned": False},
        },
        upsert=True,
    )


async def delete_user_by_identifier(identifier: str) -> bool:
    """Deletes a user's record by email OR their unique_id (whichever matches)."""
    query = {"$or": [{"email": identifier}, {"unique_id": identifier}]}
    if identifier.isdigit():
        query["$or"].append({"telegram_user_id": int(identifier)})
    result = await users_col.delete_one(query)
    return result.deleted_count > 0


async def get_all_users_summary(limit: int = 100) -> list[dict]:
    """Returns all tracked users for the /Dashboard command, most active first."""
    cursor = users_col.find().sort("last_active", -1).limit(limit)
    return await cursor.to_list(length=limit)
    
