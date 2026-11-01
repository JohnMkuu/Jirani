# Jirani Live 🇰🇪 — 1-on-1 Random Video Chat & Social Discovery

**Jirani** is a production-ready, Kenya-first social discovery and random 1v1 video chat platform. Built with real **Agora RTC Web SDK 4.x**, real-time **Socket.IO signaling**, **Safaricom M-Pesa Daraja STK Push** top-ups, virtual gifts, user presence, and safety controls matching the verified features of **PPhub, ChillHub, Ayar, CamHub, and PeaceHub**.

---

## 1. Project Structure

```text
jirani-live/
├── public/
│   └── index.html             # Responsive web client (Agora RTC, 1v1 UI, M-Pesa, Gifts, Safety)
├── tests/
│   └── run-all.js             # Automated test suite (42 tests covering Queue, Agora, M-Pesa, Admin)
├── docs/
│   ├── REFERENCE_RESEARCH_MATRIX.md  # Research analysis of PPhub, ChillHub, Ayar, CamHub, PeaceHub
│   ├── ARCHITECTURE_AND_SCHEMA.md    # System architecture & PostgreSQL relational schema
│   └── TRACEABILITY_MATRIX.md        # Feature-to-code-to-test mapping
├── mobile/
│   ├── App.tsx                # Native Android React Native / Expo container
│   ├── app.json               # Android permissions (Camera, Mic, Network)
│   ├── package.json           # Android dependencies
│   └── README.md              # Android build & APK instructions
├── server.js                  # Production Node.js + Express + Socket.IO backend
├── package.json               # Backend dependencies (agora-token, socket.io, express)
├── .env.example               # Environment variables template
├── .env                       # Local private environment configuration
├── .gitignore                 # Excludes .env, node_modules, logs
└── README.md                  # Master documentation
```

---

## 2. Quick Start (Run Locally in 2 Minutes)

### Step 1: Install Dependencies
```bash
git clone https://github.com/JohnMkuu/Jirani.git
cd Jirani
npm install
```

### Step 2: Configure Environment Variables
A development `.env` is already configured for you:
```env
PORT=3000
NODE_ENV=development
AGORA_APP_ID=92bfa202f8a94e23add6ed84e72e6317
AGORA_APP_CERTIFICATE=REPLACE_WITH_MY_CURRENT_OR_ROTATED_CERTIFICATE
AGORA_TOKEN_EXPIRY=3600

# Safaricom M-Pesa Daraja Configuration
MPESA_ENVIRONMENT=sandbox
MPESA_CONSUMER_KEY=sandbox_consumer_key_placeholder
MPESA_CONSUMER_SECRET=sandbox_consumer_secret_placeholder
MPESA_PASSKEY=bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919
MPESA_SHORTCODE=174379
MPESA_CALLBACK_URL=http://localhost:3000/api/mpesa/callback

# Admin Secret
ADMIN_SECRET=jirani_admin_secret_2026
```

> **Note on Agora Certificate:**
> - If your Agora project has **App Certificate enabled** in the Agora Console, paste your 32-character certificate into `AGORA_APP_CERTIFICATE`. The backend uses `agora-token` (`RtcTokenBuilder`) to generate cryptographic tokens.
> - If your Agora project has **App Certificate disabled** (testing mode), leave the placeholder as is. The server will pass `null` tokens, allowing the Agora Web SDK to connect directly.

### Step 3: Run the Server
```bash
npm start
```
The server will start at: **`http://localhost:3000`**

### Step 4: Run the Automated Test Suite
```bash
npm test
```
Runs the full suite of **42 automated assertions** covering:
- Agora App ID integrity & token generation
- 2-client simultaneous Socket.IO matchmaking queue pairing
- In-call real-time messaging & gift sending with atomic wallet balance updates
- Anti-self matching and anti-blocked account filtering
- Safaricom M-Pesa STK push initiation & webhook callback idempotency
- Administrator authorization and live metric tracking

---

## 3. How to Test 2 Users in Live Video Chat

To hold a genuine two-way video conversation on your machine:

1. **Window 1 (User A):**
   - Open Chrome or Edge: `http://localhost:3000`
   - Allow Camera & Microphone permissions when prompted.
   - Click the top right **"Me"** profile button to set your name (e.g. *"Alice Nairobi"*).
   - Click the big green button: **"Start Matching • 1v1 Video"**.
   - The radar will animate into searching mode.

2. **Window 2 (User B):**
   - Open a **New Incognito Window** (or a different browser such as Firefox, or a phone on the same Wi-Fi network): `http://localhost:3000`
   - Allow Camera & Microphone permissions.
   - Click the profile button to set your name (e.g. *"Bob Mombasa"*).
   - Click **"Start Matching • 1v1 Video"**.

3. **Instant 1v1 Video Connection:**
   - The backend pairs both users immediately!
   - Both users receive their Agora channel name (`jirani_ses_...`) and numeric Agora UIDs.
   - Both users see and hear each other live with full Agora RTC video!
   - Test in-call features:
     - 🎙️ **Mute/Unmute Mic**
     - 📹 **Camera On/Off**
     - 🔄 **Flip Camera** (switches cameras on compatible devices)
     - 💬 **Live Chat** (send Swahili quick phrases like *"Niaje!"* or custom text)
     - 🎁 **Send Virtual Gifts** (send a *Kenyan Rose* or *Maasai Shield*; watch the floating animated banner appear on both screens)
     - ⏭️ **Next / Skip** (instantly ends call and finds the next match)
     - 🛑 **End Call** (cleans up Agora tracks and returns to home)

---

## 4. Safaricom M-Pesa Daraja Payment Testing

1. Click the **🪙 Coin Balance** chip in the top navigation.
2. Select any coin package:
   - **Starter:** KES 100 = 100 Coins
   - **Popular:** KES 500 = 550 Coins (+50 free)
   - **Pro:** KES 1,000 = 1,200 Coins (+200 free)
   - **VIP:** KES 2,500 = 3,000 Coins (+500 free)
3. Enter your Safaricom phone number (e.g., `0712345678`).
4. Click **"Pay with M-Pesa STK Push"**.
5. In sandbox mode, click **"Simulate Instant M-Pesa PIN Success"** to instantly test webhook delivery and watch your coin balance increase in real time!
6. All transactions are logged in the immutable **Wallet Ledger** at the bottom of the modal.

---

## 5. Safety, Child Protection & Moderation

- **Strict 18+ Gate:** Displayed prominently at the top of the website. Zero tolerance for underage accounts.
- **In-Call Report Button:** Users can report bad actors with categories (*Harassment*, *Underage*, *Inappropriate Video*, *Scam*). Submitting a report automatically blocks the user.
- **Anti-Blocked Matchmaking:** Blocked accounts are filtered out server-side and will never be paired in matchmaking again.
- **Admin Dashboard (`🛡️` icon in header):**
  - Access secret: `jirani_admin_secret_2026`
  - View live active video calls and channels.
  - Review moderation reports and take actions (*Warn*, *Suspend*, *Ban*).
  - Inspect platform metrics (active users, in-queue users, total revenue in KES).

---

## 6. Android Mobile Application

The native Android app container is located in `mobile/`:
```bash
cd mobile
npm install
npm start
```
Run `npm run build:apk` to build a standalone APK for testing on physical Android devices.

---

## 7. Production Deployment Instructions

Jirani supports instant multi-cloud deployment:

### Option A: Render (Recommended for Free Persistent WebSockets)
1. Push this repository to GitHub.
2. In Render Dashboard, click **New > Blueprint** and select your repository.
3. Render automatically picks up `render.yaml` and provisions your service with zero configuration.

### Option B: Railway or Fly.io (Docker)
1. Link your GitHub repository in Railway or Fly.
2. The included `Dockerfile` and `Procfile` build and run the production container automatically.

### Option C: Vercel (Frontend & Serverless APIs)
1. Deploy directly to Vercel via the Vercel GitHub integration or CLI.
2. The included `vercel.json` and `api/index.js` serve the responsive web app from Vercel Edge CDN and route all `/api/*` endpoints to serverless functions.
3. For matchmaking on Vercel, specify your persistent WebSocket backend URL or leave blank to connect to the active host.

### Environment Variables
Configure these in your hosting provider's dashboard:
- `PORT=3000` (or dynamically assigned `$PORT`)
- `NODE_ENV=production`
- `AGORA_APP_ID=92bfa202f8a94e23add6ed84e72e6317`
- `AGORA_APP_CERTIFICATE=<YOUR_AGORA_APP_CERTIFICATE>`
- `MPESA_ENVIRONMENT=live`
- `MPESA_CONSUMER_KEY=<YOUR_LIVE_DARAJA_KEY>`
- `MPESA_CONSUMER_SECRET=<YOUR_LIVE_DARAJA_SECRET>`
- `MPESA_PASSKEY=<YOUR_LIVE_DARAJA_PASSKEY>`
- `MPESA_SHORTCODE=<YOUR_PAYBILL_OR_TILL>`
- `MPESA_CALLBACK_URL=https://yourdomain.com/api/mpesa/callback`
- `ADMIN_SECRET=<STRONG_SECRET_KEY>`
