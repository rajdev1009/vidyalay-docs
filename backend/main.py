"""
Vidyalay Coaching Centre Study Portal — FastAPI backend.

Run locally:
    uvicorn main:app --reload

On Render, the start command is:
    uvicorn main:app --host 0.0.0.0 --port $PORT
"""
import asyncio
from datetime import datetime
from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import StreamingResponse, FileResponse
import io

from config import BRANDING, CATEGORIES, BASE_URL, ADMIN_ACCESS_CODE, DEVELOPER_INFO
from database import documents_col, users_col, orders_col, ensure_indexes
from models import DocumentCreate, OrderCreate, UnlockRequest
from telegram_client import start_client, stop_client, stream_pdf_bytes
from utils import (
    generate_unique_doc_id,
    is_user_active_for_category,
    unlock_user_category,
    record_user_activity,
)

app = FastAPI(title="Vidyalay Coaching Centre Study Portal API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten this to your frontend domain in production
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    await ensure_indexes()
    try:
        await start_client()
    except Exception as e:
        # Don't crash the whole API if Telegram is briefly unavailable at boot.
        print(f"[WARN] Telegram client did not start cleanly: {e}")


@app.on_event("shutdown")
async def shutdown():
    await stop_client()


# ---------------------------------------------------------------------------
# Public: branding / categories / stats
# ---------------------------------------------------------------------------

@app.get("/api/branding")
async def get_branding():
    return BRANDING


@app.get("/api/categories")
async def get_categories():
    return {"categories": CATEGORIES}


@app.get("/api/developer")
async def get_developer_info():
    """Public info shown in the 'Developer' panel — no secrets here."""
    return DEVELOPER_INFO


# ---------------------------------------------------------------------------
# Admin backdoor — verified server-side only. The secret code never lives in
# the frontend JS; the browser just forwards whatever the visitor typed.
# ---------------------------------------------------------------------------

@app.get("/api/admin/verify")
async def admin_verify(code: str = Query(...)):
    return {"valid": code == ADMIN_ACCESS_CODE}


@app.get("/api/admin/lookup/{doc_id}")
async def admin_lookup(doc_id: str, code: str = Query(...)):
    if code != ADMIN_ACCESS_CODE:
        raise HTTPException(403, "Invalid code")
    doc = await documents_col.find_one({"doc_id": doc_id})
    if not doc:
        raise HTTPException(404, "Document not found")
    doc.pop("_id", None)
    doc.pop("telegram_message_id", None)
    doc.pop("telegram_file_unique_id", None)
    return doc


@app.get("/api/stats")
async def get_stats():
    total_materials = await documents_col.count_documents({})
    pipeline = [{"$group": {"_id": None, "total": {"$sum": "$download_count"}}}]
    agg = await documents_col.aggregate(pipeline).to_list(length=1)
    total_downloads = agg[0]["total"] if agg else 0

    latest = await documents_col.find_one(sort=[("upload_date", -1)])
    last_updated = latest["upload_date"].isoformat() if latest else None

    return {
        "total_materials": total_materials,
        "total_downloads": total_downloads,
        "last_updated": last_updated,
    }


@app.get("/api/recent")
async def recent_materials(limit: int = 10):
    cursor = documents_col.find().sort("upload_date", -1).limit(limit)
    items = await cursor.to_list(length=limit)
    for item in items:
        item.pop("_id", None)
        item.pop("telegram_message_id", None)
    return {"items": items}


# ---------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------

@app.get("/api/search")
async def search_documents(
    q: str = Query("", description="Keyword, title, or 10-digit ID"),
    category: str = Query(None),
    page: int = 1,
    page_size: int = 12,
    visitor_id: str = Query(None),
    email: str = Query(None),
):
    query = {}
    q = q.strip()
    if q:
        if q.isdigit() and len(q) == 10:
            query["doc_id"] = q
        else:
            query["$text"] = {"$search": q}
    if category:
        query["category"] = category

    skip = (page - 1) * page_size
    cursor = documents_col.find(query).skip(skip).limit(page_size).sort("upload_date", -1)
    items = await cursor.to_list(length=page_size)
    total = await documents_col.count_documents(query)

    for item in items:
        item.pop("_id", None)
        item.pop("telegram_message_id", None)
        item.pop("telegram_file_unique_id", None)

    if visitor_id or email:
        asyncio.create_task(record_user_activity(visitor_id, email, kind="search"))

    return {"items": items, "total": total, "page": page, "page_size": page_size}


# ---------------------------------------------------------------------------
# Preview (free, embedded PDF.js viewer — streams inline, no download headers)
# ---------------------------------------------------------------------------

@app.get("/api/preview/{doc_id}")
async def preview_document(
    doc_id: str,
    identifier: str = Query(..., description="email or telegram_user_id"),
    admin_code: str = Query(None, description="owner-only override, bypasses subscription check"),
    visitor_id: str = Query(None),
):
    doc = await documents_col.find_one({"doc_id": doc_id})
    if not doc:
        raise HTTPException(404, "Document not found")

    is_admin = admin_code is not None and admin_code == ADMIN_ACCESS_CODE
    active = is_admin or await is_user_active_for_category(identifier, doc["category"])
    if not active:
        raise HTTPException(
            402,
            detail={
                "message": f"Payment required. Subscribe for '{doc['category']}' access and ask the owner to /unlock your account.",
                "category": doc["category"],
                "upi_id": BRANDING["upi_id"],
                "monthly_fee_inr": BRANDING["monthly_fee_inr"],
            },
        )

    try:
        file_bytes, filename = await stream_pdf_bytes(doc["telegram_message_id"])
    except FileNotFoundError:
        raise HTTPException(404, "File missing from storage")

    if not is_admin and (visitor_id or "@" in identifier):
        asyncio.create_task(record_user_activity(visitor_id, identifier if "@" in identifier else None, kind="access"))

    return StreamingResponse(
        io.BytesIO(file_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


# ---------------------------------------------------------------------------
# Download (payment-gated — requires an active subscription)
# ---------------------------------------------------------------------------

@app.get("/api/download/{doc_id}")
async def download_document(
    doc_id: str,
    identifier: str = Query(..., description="email or telegram_user_id"),
    admin_code: str = Query(None, description="owner-only override, bypasses subscription check"),
    visitor_id: str = Query(None),
):
    doc = await documents_col.find_one({"doc_id": doc_id})
    if not doc:
        raise HTTPException(404, "Document not found")

    is_admin = admin_code is not None and admin_code == ADMIN_ACCESS_CODE
    active = is_admin or await is_user_active_for_category(identifier, doc["category"])
    if not active:
        raise HTTPException(
            402,
            detail={
                "message": f"Payment required. Subscribe for '{doc['category']}' access and ask the owner to /unlock your account.",
                "category": doc["category"],
                "upi_id": BRANDING["upi_id"],
                "monthly_fee_inr": BRANDING["monthly_fee_inr"],
            },
        )

    try:
        file_bytes, filename = await stream_pdf_bytes(doc["telegram_message_id"])
    except FileNotFoundError:
        raise HTTPException(404, "File missing from storage")

    await documents_col.update_one({"doc_id": doc_id}, {"$inc": {"download_count": 1}})

    if not is_admin and (visitor_id or "@" in identifier):
        asyncio.create_task(record_user_activity(visitor_id, identifier if "@" in identifier else None, kind="download"))

    return StreamingResponse(
        io.BytesIO(file_bytes),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(len(file_bytes)),
        },
    )


# ---------------------------------------------------------------------------
# Orders / payment intent logging (manual verification via Telegram bot)
# ---------------------------------------------------------------------------

@app.post("/api/orders")
async def create_order(order: OrderCreate):
    """
    Called when a user opens the payment popup and scans the UPI QR.
    This just logs the intent — the owner verifies payment manually and
    runs /unlock in the Telegram bot.
    """
    order_doc = order.dict()
    order_doc["created_at"] = datetime.utcnow()
    order_doc["status"] = "pending_verification"
    result = await orders_col.insert_one(order_doc)

    # Notify the owner via the bot (best-effort, non-blocking)
    try:
        from bot import notify_owner_of_order
        asyncio.create_task(notify_owner_of_order(order_doc))
    except Exception as e:
        print(f"[WARN] Could not notify owner: {e}")

    return {"order_id": str(result.inserted_id), "status": "pending_verification"}


@app.get("/api/subscription-status")
async def subscription_status(identifier: str, category: str):
    active = await is_user_active_for_category(identifier, category)
    return {"identifier": identifier, "category": category, "active": active}


# ---------------------------------------------------------------------------
# Admin-only internal endpoints (used by the Telegram bot, not exposed publicly)
# ---------------------------------------------------------------------------

@app.post("/internal/documents")
async def internal_create_document(doc: DocumentCreate):
    """Called by the Telegram bot after a file finishes uploading."""
    doc_id = await generate_unique_doc_id()
    record = doc.dict()
    record["doc_id"] = doc_id
    record["upload_date"] = datetime.utcnow()
    record["download_count"] = 0
    await documents_col.insert_one(record)
    return {"doc_id": doc_id}


@app.delete("/internal/documents/{doc_id}")
async def internal_delete_document(doc_id: str):
    result = await documents_col.delete_one({"doc_id": doc_id})
    if result.deleted_count == 0:
        raise HTTPException(404, "Document not found")
    return {"deleted": doc_id}


@app.post("/internal/unlock")
async def internal_unlock(req: UnlockRequest):
    expiry = await unlock_user_category(req.identifier, req.category, req.days)
    return {"identifier": req.identifier, "category": req.category, "subscription_expiry": expiry.isoformat()}


@app.delete("/internal/admin/wipe-documents")
async def admin_wipe_all_documents(code: str = Query(...)):
    """
    Owner-only. Deletes every document RECORD from the database (titles,
    categories, IDs, download counts). The actual files stay untouched in
    the Telegram storage channel — this only clears the site's listing.
    """
    if code != ADMIN_ACCESS_CODE:
        raise HTTPException(403, "Invalid code")
    result = await documents_col.delete_many({})
    return {"deleted_count": result.deleted_count}


# Serve the static frontend (index.html, assets) from the same service.
app.mount("/", StaticFiles(directory="../frontend", html=True), name="frontend")
