"""
Async MongoDB connection (Motor) — MongoDB Atlas free tier friendly.
"""
from motor.motor_asyncio import AsyncIOMotorClient
from config import MONGO_URI, MONGO_DB_NAME

client = AsyncIOMotorClient(MONGO_URI)
db = client[MONGO_DB_NAME]

# Collections
documents_col = db["documents"]        # study material metadata
users_col = db["users"]                # registered users / subscribers
orders_col = db["orders"]              # payment/order logs
counters_col = db["counters"]          # for aggregate stats (downloads, etc.)


async def ensure_indexes():
    """Call once on startup to create indexes for fast search & lookups."""
    await documents_col.create_index("doc_id", unique=True)
    await documents_col.create_index([("title", "text"), ("description", "text")])
    await documents_col.create_index("category")
    await users_col.create_index("email", unique=True, sparse=True)
    await users_col.create_index("telegram_user_id", unique=True, sparse=True)
    await users_col.create_index("unique_id", unique=True, sparse=True)
    await orders_col.create_index("created_at")
