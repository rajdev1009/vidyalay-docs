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


# ---------------------------------------------------------------------------
# Site-wide announcement banner (shown above the header on the website,
# set/updated/cleared via the /broadcast command)
# ---------------------------------------------------------------------------

async def set_broadcast_message(text: str):
    from database import settings_col
    await settings_col.update_one(
        {"_id": "broadcast"},
        {"$set": {"text": text, "updated_at": datetime.utcnow()}},
        upsert=True,
    )


async def clear_broadcast_message():
    from database import settings_col
    await settings_col.delete_one({"_id": "broadcast"})


async def get_broadcast_message() -> str | None:
    from database import settings_col
    doc = await settings_col.find_one({"_id": "broadcast"})
    return doc["text"] if doc else None


# ---------------------------------------------------------------------------
# Course metadata — online/offline + location, full-course price, monthly
# price. Stored per category name; falls back to sensible defaults if the
# owner has never customised that category.
# ---------------------------------------------------------------------------

async def get_course_info(category: str, default_monthly_fee: int) -> dict:
    from database import courses_col
    doc = await courses_col.find_one({"_id": category}) or {}
    return {
        "category": category,
        "type": doc.get("type", "online"),
        "location": doc.get("location"),
        "full_course_price": doc.get("full_course_price"),
        "monthly_price": doc.get("monthly_price", default_monthly_fee),
    }


async def set_course_price(category: str, kind: str, price: int):
    """kind: 'full' or 'monthly'"""
    from database import courses_col
    field = "full_course_price" if kind == "full" else "monthly_price"
    await courses_col.update_one({"_id": category}, {"$set": {field: price}}, upsert=True)


async def set_course_offline(category: str, location: str):
    from database import courses_col
    await courses_col.update_one({"_id": category}, {"$set": {"type": "offline", "location": location}}, upsert=True)


async def set_course_online(category: str):
    from database import courses_col
    await courses_col.update_one({"_id": category}, {"$set": {"type": "online", "location": None}}, upsert=True)


# ---------------------------------------------------------------------------
# Per-file premium pricing — a file can be marked premium with its own
# price, purchasable on its own without a full category subscription.
# ---------------------------------------------------------------------------

async def set_file_premium(doc_id: str, price: int):
    await documents_col.update_one({"doc_id": doc_id}, {"$set": {"is_premium": True, "file_price_inr": price}})


async def remove_file_premium(doc_id: str):
    await documents_col.update_one({"doc_id": doc_id}, {"$set": {"is_premium": False, "file_price_inr": None}})


# ---------------------------------------------------------------------------
# Full-course unlock (one payment, everything in that category incl.
# premium files, effectively permanent) and single-file unlock (one
# payment, access to exactly one premium file, no category-wide access).
# Both reuse the existing category_access / users_col structures so the
# rest of the access-check logic stays in one place.
# ---------------------------------------------------------------------------

FULL_COURSE_DAYS = 365 * 100  # "lifetime" — represented as a far-future expiry


async def unlock_full_course(identifier: str, category: str):
    return await unlock_user_category(identifier, category, days=FULL_COURSE_DAYS)


async def unlock_file_for_user(identifier: str, doc_id: str):
    query = {"email": identifier} if not identifier.isdigit() else {"telegram_user_id": int(identifier)}
    set_doc = {"is_banned": False}
    if identifier.isdigit():
        set_doc["telegram_user_id"] = int(identifier)
    else:
        set_doc["email"] = identifier
    await users_col.update_one(
        query,
        {
            "$set": set_doc,
            "$addToSet": {"unlocked_docs": doc_id},
            "$setOnInsert": {"created_at": datetime.utcnow()},
        },
        upsert=True,
    )


async def is_user_active_for_doc(identifier: str, doc: dict) -> bool:
    """
    Non-premium docs: unchanged — needs category-wide access (monthly or
    full-course, both stored the same way).
    Premium docs: category-wide access ALSO works (monthly/full-course
    unlocks every file, premium or not), OR the doc was bought individually.
    """
    if await is_user_active_for_category(identifier, doc["category"]):
        return True
    if not doc.get("is_premium"):
        return False

    user = await users_col.find_one(_lookup_query(identifier))
    if not user or user.get("is_banned"):
        return False
    return doc["doc_id"] in (user.get("unlocked_docs") or [])

    
