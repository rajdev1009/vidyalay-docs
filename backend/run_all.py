"""
Runs both the FastAPI web server and the Telegram admin bot in a single
process — convenient for Render's single free web-service instance.

Start command on Render:
    python run_all.py
"""
import asyncio
import os
import uvicorn
from config import BOT_TOKEN

from bot import bot as admin_bot, main as bot_main
from main import app


async def run_web():
    port = int(os.getenv("PORT", "8000"))
    config = uvicorn.Config(app, host="0.0.0.0", port=port, loop="asyncio")
    server = uvicorn.Server(config)
    await server.serve()


async def run_bot():
    if not BOT_TOKEN:
        print("[WARN] BOT_TOKEN not set — admin bot will not start.")
        return
    await bot_main()


async def main():
    await asyncio.gather(run_web(), run_bot())


if __name__ == "__main__":
    asyncio.run(main())
