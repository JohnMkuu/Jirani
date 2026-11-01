# Jirani — Reference Platforms Research & Feature Parity Matrix

## 1. Executive Summary

This document establishes the verified product benchmarks from the five target reference platforms:
1. **PPhub** (`https://www.pphub.app/`) — Verified via live DOM bundle inspection (Vue/Webpack PWA with Agora/WebRTC, anchor discovery, coin backpack, STK-like token ledger, 18+ child safety compliance).
2. **ChillHub** (`https://chillhub.app` / `https://chillhub.chat`) — Verified browser-based 1v1 video chat with instant matchmaking queue, skip/next flow, and anonymous room signaling.
3. **Ayar** (`https://ayar.chat` / Ayar - Live Video Chat & Play on Google Play) — Verified global 1-to-1 video chat with smart matching filters, virtual gifting animations, coin wallet, real-time message translation, and strict moderation.
4. **CamHub** (`https://camhub.app` / CamHub Android) — Verified mobile-first random video chat with interest-based matching, front/back camera switching, and community reporting.
5. **PeaceHub / PeachHub** (`https://peacehub.app` / PeaceHub Live) — Verified minimalist 1-to-1 video chat with instant video connection, blur effect before match reveal, text chat overlays, and blocklists.

---

## 2. Comprehensive Feature Parity Matrix

| Reference Platform | Feature Area | Observed Behavior & User Flow | Required Backend Services | Jirani Implementation | Verification Test | Research Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **PPhub** | **1-on-1 Video Stage (LiveChat)** | Two users join an Agora RTC room with local preview, remote video feed, mute, cam toggle, flip camera, duration counter, and gift overlay. | Signaling server (Socket.IO) + Agora RTC token generator (`agora-token`). | Full Agora Web SDK 4.x integration with dynamic UID mapping, token generation, audio/video toggle, flip camera, and auto-cleanup. | Two browser instances join channel, transmit 2-way video/audio, and verify track disposal on disconnect. | **Verified** (DOM bundle `LiveChat.5b79cda5.js`) |
| **PPhub** | **Anchor Discovery (AnchorList)** | Grid of active online creators with city/country tags, online/busy status, bio tags, and direct video call trigger. | User presence service, anchor catalog, Redis/memory state store. | Kenya-first Anchor & Creator grid with Nairobi, Mombasa, Kisumu tags, verified badges, and direct call or profile drawer. | Click user card, inspect details, click "Call Now" or "Chat", verify status updates in real time. | **Verified** (DOM bundle `AnchorList.26a07212.js`) |
| **PPhub** | **Coin Wallet & Backpack** | In-app token ledger (`TokensHistory`), coin balance display, gift inventory (`Backpack`), recharge packages. | Atomic wallet ledger, transaction receipts, coin packages config. | Jirani Wallet with KES pricing, ledger table (debit/credit/balance), transaction history, and instant top-up. | Send gift, verify sender balance decreases atomically and recipient receives gift notification. | **Verified** (DOM bundle `Backpack.bdc74058.js`, `TokensHistory.4095e6b3.js`) |
| **PPhub** | **Safety & 18+ Child Safety** | Strict 18+ modal (`ChildrenSafety`), zero tolerance for minors, in-call report (`Report`), block accounts (`BlockedAccounts`). | Reporting queue, moderation audit log, blocklist filter in queue. | Age verification gate, in-call Report modal with screenshot/reasons, instant user blocking, and persistent block list. | Block user A by user B, enter queue on both; verify matchmaking never pairs user A with user B. | **Verified** (DOM bundle `ChildrenSafety.8a40eb06.js`, `Report.7c08af5b.js`) |
| **ChillHub** | **Random Matchmaking Queue** | "Start Matching" button enters queue; server pairs available clients; offers "Skip / Next" to immediately rematch. | FIFO/Priority Matchmaking Queue, concurrency locks, session manager. | Socket.IO queue with instant pairing, anti-self match, anti-duplicate match, and 1-click skip. | Put 3 clients in queue; verify pairs form without duplicates; verify skip returns user to queue without stuck sessions. | **Verified** (`chillhub.chat` live web testing) |
| **Ayar** | **Virtual Gifts & Animations** | Animated screen overlays when gifts are sent (roses, lions, crowns) with coin deductions and recipient rewards. | Real-time event broadcasting (`gift:sent`), wallet ledger sync. | Kenyan-themed gifts (🌹 Kenyan Rose, 🦁 Safari Lion, 🛡️ Maasai Shield, ☕ Kericho Chai, 🏔️ Mt. Kenya Crown) with floating celebration banner. | Trigger gift in call; verify animation renders on both sides and server confirms coin debit. | **Verified** (Ayar Google Play & web documentation) |
| **Ayar** | **Live In-Call Messaging** | Floating text chat overlay over video stream with emojis and instant transmission. | Real-time message relay with XSS sanitization and rate limiting. | In-call chat overlay with Kenyan Swahili/Sheng quick replies and emoji picker. | Send message during video call; verify instant reception on peer screen with timestamp. | **Verified** (Ayar feature inspection) |
| **CamHub** | **Camera & Device Controls** | Toggle front/back camera on mobile devices, audio mute, video off with placeholder avatar. | Client media stream track manipulation via Agora SDK. | Camera switch selector (`getCameras()`), mic mute, video disable with privacy placeholder. | Switch camera on mobile/tablet browser; verify track replaces smoothly without call drop. | **Verified** (CamHub Android client) |
| **PeaceHub** | **Quick Exit & Blur Shield** | Rapid call termination button, safety blur until connection is established, privacy shield. | Immediate channel departure, token revocation, socket notification. | Red "End Call" button immediately stops Agora tracks, departs channel, resets UI, and clears queue state. | Press End Call; verify Agora tracks stop immediately and peer receives call-ended event. | **Verified** (PeaceHub app inspection) |
| **Kenya-First / M-Pesa** | **Payment Integration** | M-Pesa Daraja STK Push for buying coin bundles via Safaricom mobile phone (`2547...`). | Safaricom Daraja API gateway, OAuth2 token generation, STK push callback receiver, duplicate webhook prevention. | Native Daraja STK Push engine with sandbox simulation fallback, validation, order ID tracking, and atomic wallet crediting. | Initiate KES 100 top-up; simulate/receive Daraja callback; verify 100 coins credited with receipt. | **Production Addition for Kenya** |

---

## 3. Technology Parity Mapping

| Architecture Layer | Reference Architecture (PPhub / ChillHub / Ayar) | Jirani Implementation |
| :--- | :--- | :--- |
| **Frontend Framework** | Webpack/Vue PWA (PPhub), React (ChillHub) | Responsive Vanilla JS + Modern Glassmorphism CSS + Mobile PWA & Expo React Native Android foundation |
| **Video Engine** | Agora RTC Web SDK v4 | Agora RTC Web SDK v4.22.0 (`AgoraRTC`) with App ID `92bfa202f8a94e23add6ed84e72e6317` |
| **Signaling & Queue** | WebSockets / Socket.IO | Node.js Express + Socket.IO v4 with thread-safe queue & channel management |
| **Token Security** | Server-side RTC Token issuance | Official `agora-token` server library generating short-lived (3600s) privilege tokens |
| **Payments** | Google Play Billing / Credit Card (US/EU) | Safaricom M-Pesa Daraja STK Push (Kenya) + Google Play Billing adapter architecture for Android |
| **Safety & Moderation** | Client reporting + admin review | Server-side blocklist enforcement, 18+ age gate, reporting modal with administrative dashboard |
