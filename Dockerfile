# Vidyalay Coaching Centre Study Portal — single-container deploy.
# Builds the FastAPI backend + Telegram bot, and serves the static frontend
# from the same container. No manual "Root Directory" setting needed on
# Render — this file handles paths and the Python version itself.

FROM python:3.11-slim

# Keep pip/py output unbuffered and avoid .pyc clutter
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Install backend dependencies first (better Docker layer caching)
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r backend/requirements.txt

# Copy the rest of the project
COPY backend backend
COPY frontend frontend

# main.py serves the frontend via a relative "../frontend" path, so run
# from inside backend/ — same as local development.
WORKDIR /app/backend

# Render provides $PORT at runtime; run_all.py already reads it.
CMD ["python", "run_all.py"]
