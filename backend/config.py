"""
Central configuration for Vidyalay Coaching Centre Study Portal.
All secrets are loaded from environment variables — never hard-code them.
"""
import os
from dotenv import load_dotenv

load_dotenv()

# ---------- Telegram ----------
TELEGRAM_API_ID = int(os.getenv("TELEGRAM_API_ID", "0"))
TELEGRAM_API_HASH = os.getenv("TELEGRAM_API_HASH", "")
TELEGRAM_STRING_SESSION = os.getenv("TELEGRAM_STRING_SESSION", "")
BOT_TOKEN = os.getenv("BOT_TOKEN", "")
OWNER_CHAT_ID = int(os.getenv("OWNER_CHAT_ID", "0"))
STORAGE_CHANNEL_ID = int(os.getenv("STORAGE_CHANNEL_ID", "0"))  # private channel used as file storage

# ---------- Database ----------
MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
MONGO_DB_NAME = os.getenv("MONGO_DB_NAME", "vidyalay_docs")

# ---------- App ----------
APP_SECRET_KEY = os.getenv("APP_SECRET_KEY", "change-this-in-production")
BASE_URL = os.getenv("BASE_URL", "http://localhost:8000")
ENV = os.getenv("ENV", "development")

# ---------- Admin backdoor (owner-only) ----------
# Used by the "Developer" panel on the site to unlock free preview/download
# access to ANY document, bypassing the subscription check. This value is
# NEVER sent to the browser — the frontend only sends whatever the visitor
# typed, and the comparison happens here, server-side, only.
# Override in your .env / Render environment variables in production.
ADMIN_ACCESS_CODE = os.getenv("ADMIN_ACCESS_CODE", "raj7578848529")

# ---------- Developer info (shown in the "Developer" panel on the site) ----------
DEVELOPER_INFO = {
    "name": "Raj Dev",
    "role": "Full Stack Developer",
    "telegram": "@raj_dev_01",
    "skills": ["Python", "JavaScript", "HTML", "CSS", "Linux", "C++"],
    "about": (
        "This platform was built to give students a fast, reliable way to "
        "find and download verified exam study material - organized by "
        "category, searchable by keyword or ID, previewable before purchase, "
        "and backed by a Telegram-based storage and admin system."
    ),
}

# ---------- Branding (editable by the owner) ----------
BRANDING = {
    "coaching_name": os.getenv("COACHING_NAME", "Vidyalay Coaching Centre"),
    "tagline": os.getenv("COACHING_TAGLINE", "Your Trusted Partner for Government Job Success"),
    "phone": os.getenv("COACHING_PHONE", "+91 7099451692"),
    "email": os.getenv("COACHING_EMAIL", "soptam55@gmail.com"),
    "upi_id": os.getenv("COACHING_UPI_ID", "vidyalaycoaching@upi"),
    "monthly_fee_inr": int(os.getenv("MONTHLY_FEE_INR", "99")),
    "disclaimer": (
        "For educational and reference purposes only. "
        "All materials are curated for Vidyalay Coaching Centre aspirants."
    ),
}

# ---------- Categories ----------
CATEGORIES = [
    "ADRE Grade III & IV",
    "Assam Police",
    "SSC Exams",
    "Railway Exams",
    "Handwritten Notes",
    "General Study Materials",
]
