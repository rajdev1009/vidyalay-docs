"""
Pydantic schemas used for request/response validation.
"""
from pydantic import BaseModel, Field, EmailStr
from typing import Optional
from datetime import datetime


class DocumentOut(BaseModel):
    doc_id: str                     # unique 10-digit public ID
    title: str
    category: str
    description: str
    file_size_mb: float
    upload_date: datetime
    download_count: int = 0
    preview_available: bool = True


class DocumentCreate(BaseModel):
    title: str
    category: str
    description: str
    telegram_message_id: int
    telegram_file_unique_id: str
    file_size_mb: float


class UserOut(BaseModel):
    email: Optional[EmailStr] = None
    telegram_user_id: Optional[int] = None
    is_subscribed: bool = False
    subscription_expiry: Optional[datetime] = None
    is_banned: bool = False
    created_at: datetime


class OrderCreate(BaseModel):
    email: Optional[EmailStr] = None
    doc_id: Optional[str] = None
    category: Optional[str] = None
    amount_inr: int
    note: Optional[str] = None


class UnlockRequest(BaseModel):
    identifier: str   # email or telegram user id
    category: str     # which category to grant access to
    days: int = 30
    
