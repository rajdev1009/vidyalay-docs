"""
Populate MongoDB with sample document metadata so the portal looks active
immediately after deployment.

NOTE: This only inserts METADATA records. It does not upload real PDF files
to Telegram — for that, use the /add flow in the bot with real files.
These sample records point at placeholder telegram_message_id values, so
their preview/download endpoints will 404 until you replace them with real
uploads via /add.

Run:
    python seed_data.py
"""
import asyncio
from datetime import datetime, timedelta
import random

from database import documents_col
from utils import generate_unique_doc_id

SAMPLE_DOCS = [
    {
        "title": "ADRE Grade III - General Knowledge Complete Notes",
        "category": "ADRE Grade III & IV",
        "description": "Comprehensive GK notes covering Assam history, polity, and current affairs for ADRE Grade III & IV aspirants.",
        "file_size_mb": 6.4,
    },
    {
        "title": "Assam Police SI - Reasoning & Mental Ability Handbook",
        "category": "Assam Police",
        "description": "Practice sets and shortcuts for the reasoning section of the Assam Police SI written exam.",
        "file_size_mb": 5.1,
    },
    {
        "title": "SSC CGL Tier-1 Quantitative Aptitude Notes",
        "category": "SSC Exams",
        "description": "Chapter-wise formulas, tricks, and previous year questions for SSC CGL Tier-1 Maths.",
        "file_size_mb": 7.8,
    },
    {
        "title": "Railway RRB NTPC General Awareness PDF",
        "category": "Railway Exams",
        "description": "Updated general awareness capsule for RRB NTPC CBT-1 and CBT-2.",
        "file_size_mb": 4.9,
    },
    {
        "title": "Handwritten Notes - Indian Polity (Complete)",
        "category": "Handwritten Notes",
        "description": "Neatly handwritten, exam-focused notes on Indian Polity covering the Constitution, amendments, and governance.",
        "file_size_mb": 8.2,
    },
    {
        "title": "General Studies Master PDF - Static GK 2026 Edition",
        "category": "General Study Materials",
        "description": "All-in-one static GK compilation useful across ADRE, SSC, Police, and Railway exams.",
        "file_size_mb": 9.3,
    },
]


async def seed():
    inserted = 0
    for i, sample in enumerate(SAMPLE_DOCS):
        doc_id = await generate_unique_doc_id()
        record = {
            "doc_id": doc_id,
            "title": sample["title"],
            "category": sample["category"],
            "description": sample["description"],
            # Placeholder — replace by uploading real files through the /add bot command.
            "telegram_message_id": -1,
            "telegram_file_unique_id": f"placeholder-{doc_id}",
            "file_size_mb": sample["file_size_mb"],
            "upload_date": datetime.utcnow() - timedelta(days=random.randint(0, 20)),
            "download_count": random.randint(15, 480),
        }
        await documents_col.insert_one(record)
        inserted += 1
        print(f"Seeded: {record['title']} -> ID {doc_id}")

    print(f"\n✅ Done. Inserted {inserted} sample documents.")


if __name__ == "__main__":
    asyncio.run(seed())
