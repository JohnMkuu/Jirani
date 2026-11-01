# Jirani Live — Android Mobile Application Guide

## 1. Overview

The Jirani Android application provides a native mobile experience for Kenyan 1-on-1 random video chat. It connects to the shared backend (`server.js`) on the same user accounts, wallet ledger, matchmaking queue, Agora RTC channels, and Safaricom M-Pesa payments.

## 2. Prerequisites

- Node.js >= 18
- Android Studio with Android SDK (API 34 Recommended)
- Java JDK 17
- Expo CLI (`npm install -g expo-cli eas-cli`)

## 3. Quick Start (Development)

1. Navigate to the mobile folder:
   ```bash
   cd mobile
   npm install
   ```

2. Point the backend URL:
   - For Android Emulator: `http://10.0.2.2:3000` (pre-configured in `App.tsx`)
   - For Physical Android Device via Wi-Fi: Replace with your local machine's IP (e.g., `http://192.168.1.50:3000`)

3. Start the Expo development server:
   ```bash
   npm start
   ```

4. Press `a` in the terminal to launch the Android emulator, or scan the QR code with Expo Go on your Android phone.

## 4. Building a Standalone Android APK / AAB

1. Configure EAS Build (free cloud or local):
   ```bash
   npx eas-cli login
   npx eas-cli build:configure
   ```

2. Build standalone APK for direct installation:
   ```bash
   npm run build:apk
   ```

3. Build signed Android App Bundle (AAB) for Google Play Store:
   ```bash
   eas build --platform android --profile production
   ```

## 5. Android Permissions Included

The app's `app.json` includes all hardware access permissions for Agora 1v1 video:
- `android.permission.CAMERA`
- `android.permission.RECORD_AUDIO`
- `android.permission.MODIFY_AUDIO_SETTINGS`
- `android.permission.INTERNET`
- `android.permission.ACCESS_NETWORK_STATE`
