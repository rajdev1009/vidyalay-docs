# Vidyalay Coaching Centre — Study Portal (VidyalayDocs)

A document portal for ADRE (Grade III & IV), Assam Police, SSC, and Railway exam
study materials. Free preview via an in-browser PDF viewer, paid monthly
subscription for direct downloads. Files are stored in a private Telegram
channel (via Telethon) instead of on disk, so the whole thing runs comfortably
on Render's free/starter tiers. There is no web admin login — the owner
manages everything through Telegram bot commands.

---

## 1. Project structure

```
vidyalay-docs/
├── backend/
│   ├── main.py              # FastAPI app (search, preview, download, orders)
│   ├── bot.py                # Telegram admin bot (/add, /delete, /list, ...)
│   ├── run_all.py            # Runs the API + bot together (Render start command)
│   ├── telegram_client.py    # Telethon string-session client (upload/stream/delete)
│   ├── database.py           # MongoDB (Motor) connection + indexes
│   ├── models.py             # Pydantic schemas
│   ├── config.py             # Env vars + branding config
│   ├── utils.py              # ID generation, subscription checks
│   ├── generate_session.py   # One-time script to create TELEGRAM_STRING_SESSION
│   ├── seed_data.py          # Inserts 6 sample documents for a live-looking demo
│   └── requirements.txt
├── frontend/
│   ├── index.html
│   ├── app.js
│   └── style.css
├── .env.example
└── README.md
```

---

## 2. Prerequisites

- A Telegram account (used for the string session that stores/streams files)
- A Telegram Bot from [@BotFather](https://t.me/BotFather) (used for owner admin commands)
- A private Telegram channel you own, used purely as file storage
- A free [MongoDB Atlas](https://www.mongodb.com/cloud/atlas/register) cluster
- A [Render](https://render.com) account

---

## 3. Get Telegram API credentials

1. Go to <https://my.telegram.org> → log in → **API development tools**.
2. Create an app and note down `api_id` and `api_hash`.

---

## 4. Generate your Telethon string session

This session belongs to a real Telegram **user** account (not the bot) and is
what actually uploads/downloads files to your private storage channel.

```bash
cd backend
pip install -r requirements.txt
python generate_session.py
```

You'll be asked for your `api_id`, `api_hash`, phone number, and the login
code sent to your Telegram app. The script prints a long string — copy it
into `TELEGRAM_STRING_SESSION`.

**Keep this string secret.** Anyone with it has full access to that Telegram account.

---

## 5. Create your private storage channel

1. In Telegram, create a new **private channel** (e.g. "Vidyalay Storage").
2. Add the same account you used for the string session as an admin (it
   already is, since you created it).
3. Get the channel's numeric ID:
   - Forward any message from the channel to [@userinfobot](https://t.me/userinfobot), or
   - Use `client.get_entity()` in a quick Python snippet with your session.
4. Channel IDs look like `-1001234567890`. Put this in `STORAGE_CHANNEL_ID`.

---

## 6. Create your admin bot

1. Message [@BotFather](https://t.me/BotFather) → `/newbot` → follow the prompts.
2. Copy the token into `BOT_TOKEN`.
3. Get your own numeric Telegram user ID from [@userinfobot](https://t.me/userinfobot) and put it in `OWNER_CHAT_ID` — this restricts all admin commands to you alone.
4. Start a chat with your new bot (send it `/start`) so it's able to message you.

---

## 7. MongoDB Atlas setup

1. Create a free (M0) cluster.
2. Create a database user with a password.
3. Under **Network Access**, allow access from anywhere (`0.0.0.0/0`) — Render's outbound IPs are dynamic on the free plan.
4. Copy the connection string into `MONGO_URI`, e.g.:
   ```
   mongodb+srv://<user>:<password>@cluster0.xxxxx.mongodb.net
   ```

---

## 8. Environment variables

Copy `.env.example` to `.env` and fill in every value:

```bash
cp .env.example .env
```

| Variable | Description |
|---|---|
| `MONGO_URI` | MongoDB Atlas connection string |
| `MONGO_DB_NAME` | Database name (default `vidyalay_docs`) |
| `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` | From my.telegram.org |
| `TELEGRAM_STRING_SESSION` | From `generate_session.py` |
| `STORAGE_CHANNEL_ID` | Your private channel's numeric ID |
| `BOT_TOKEN` | From @BotFather |
| `OWNER_CHAT_ID` | Your Telegram user ID |
| `COACHING_NAME`, `COACHING_TAGLINE`, `COACHING_PHONE`, `COACHING_EMAIL` | Branding shown on the site |
| `COACHING_UPI_ID`, `MONTHLY_FEE_INR` | Payment details shown in the popup |

---

## 9. Run locally

```bash
cd backend
pip install -r requirements.txt
python run_all.py
```

This starts both the FastAPI server (port `8000`) and the Telegram bot in one
process. Visit `http://localhost:8000`.

To seed sample data so the homepage looks active immediately:

```bash
python seed_data.py
```

> Note: seeded documents are metadata-only placeholders. Their preview/download
> will 404 until you replace them with real uploads via the bot's `/add` command.

---

## 10. Deploy on Render

1. Push this repo to GitHub.
2. On Render: **New → Web Service** → connect the repo.
3. Settings:
   - **Root directory:** `backend`
   - **Build command:** `pip install -r requirements.txt`
   - **Start command:** `python run_all.py`
4. Add every variable from `.env` under **Environment**.
5. Deploy. Render assigns a `PORT` automatically — `run_all.py` already reads it.

Since the frontend is served as static files by FastAPI (`app.mount("/", ...)`
in `main.py`), there's nothing extra to deploy — one Render service handles both.

---

## 11. Bot commands (owner only, via Telegram)

| Command | What it does |
|---|---|
| `/add` | Guided flow: asks for title → category → description → PDF file, then uploads it and assigns a 10-digit ID |
| `/delete <10-digit-id>` | Permanently removes a document and its stored file |
| `/list` | Lists all current documents with IDs and download counts |
| `/stats` | Total files, downloads, registered users, active subscribers, pending orders |
| `/unlock <email or telegram_id>` | Grants/extends 30 days of download access after verifying payment |
| `/ban <email>` | Blocks a user's download access |
| `/unban <email>` | Restores a blocked user |
| `/broadcast <message>` | Sends a message to every registered user |

When a visitor clicks "I've Paid" in the payment popup, the bot automatically
messages the owner with the order details and a ready-to-copy `/unlock` command.

---

## 12. How the payment flow works (manual verification, by design)

1. Visitor searches and previews documents for free (PDF.js viewer, no download).
2. Clicking **Download** checks subscription status by email.
3. If not subscribed, a modal shows the UPI QR code and ID for the monthly fee.
4. The visitor pays via any UPI app, enters their email, and taps **I've Paid**.
5. The owner gets a Telegram notification and verifies the payment manually
   (checking their bank/UPI app), then runs `/unlock <email>`.
6. The visitor's downloads unlock for 30 days from that point.

This keeps the system simple and avoids integrating a payment gateway, at the
cost of requiring the owner to check payments by hand. If you later want
automatic verification, swap in a UPI payment gateway (e.g. Razorpay, Cashfree)
and call `/internal/unlock` from its webhook instead of doing it manually.

---

## 13. Adding real study materials

Sample data from `seed_data.py` is metadata-only. To make real PDFs
downloadable:

1. Open a chat with your bot.
2. Send `/add`.
3. Follow the prompts (title → category → description → attach the PDF).
4. The bot uploads it to your private storage channel and replies with the
   new 10-digit ID — it's now live on the site.

---

## 14. Security notes

- `TELEGRAM_STRING_SESSION` and `BOT_TOKEN` are equivalent to passwords —
  never commit them to git or expose them client-side.
- The `/internal/*` API endpoints are meant to be called only by the bot
  process; if you deploy the API separately from the bot, put them behind a
  firewall rule or shared-secret header before going to production.
- Tighten `allow_origins=["*"]` in `main.py`'s CORS config to your real
  domain once you have one.
