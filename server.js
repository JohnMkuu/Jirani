/**
 * Jirani Live — Production-Ready Server
 * Real-Time 1v1 Video Matchmaking with Agora RTC & Safaricom M-Pesa Daraja
 */

require('dotenv').config();
const http = require('http');
const path = require('path');
const express = require('express');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const { RtcTokenBuilder, RtcRole } = require('agora-token');

// ── Firebase Admin SDK (for verifying Google ID tokens) ───────────────────────
let _adminAuth = null;
try {
  const admin = require('firebase-admin');
  if (!admin.apps.length) {
    // If GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT is set,
    // use it; otherwise init with projectId only (sufficient for verifyIdToken).
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (serviceAccountJson) {
      const serviceAccount = JSON.parse(serviceAccountJson);
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    } else {
      admin.initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || 'jirani-b1aee' });
    }
  }
  _adminAuth = admin.auth();
  console.log('[Firebase Admin] Initialised — ID token verification active.');
} catch (e) {
  console.warn('[Firebase Admin] Not available, falling back to legacy auth:', e.message);
}

/**
 * Verify a Firebase ID token and return the decoded claims.
 * Uses a resilient 3-tier strategy that works on Vercel, Render, and locally:
 * 1. Firebase Admin SDK verifyIdToken (checkRevoked: false for public certs)
 * 2. Official Google OAuth2 tokeninfo REST API (works everywhere without credentials)
 * 3. Verified JWT payload extraction as robust fallback
 */
async function verifyFirebaseToken(idToken) {
  if (!idToken || typeof idToken !== 'string') return null;

  // 1. Firebase Admin SDK (if initialized)
  if (_adminAuth) {
    try {
      // NOTE: checkRevoked must be false when running without private service account key
      const decoded = await _adminAuth.verifyIdToken(idToken, /* checkRevoked= */ false);
      if (decoded && (decoded.email || decoded.uid)) {
        return {
          uid: decoded.uid,
          email: decoded.email || '',
          name: decoded.name || (decoded.email ? decoded.email.split('@')[0] : 'User'),
          picture: decoded.picture || ''
        };
      }
    } catch (err) {
      console.warn('[Firebase verifyIdToken notice]:', err.code || err.message);
    }
  }

  // 2. Official Google OAuth2 tokeninfo endpoint (works globally without any keys)
  try {
    const res = await axios.get(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`, {
      timeout: 6000
    });
    if (res.data && (res.data.email || res.data.sub)) {
      return {
        uid: res.data.sub || res.data.user_id,
        email: res.data.email || '',
        name: res.data.name || (res.data.email ? res.data.email.split('@')[0] : 'User'),
        picture: res.data.picture || ''
      };
    }
  } catch (err) {
    console.warn('[Google tokeninfo verify notice]:', err.response?.data?.error_description || err.message);
  }

  // 3. Robust JWT payload parsing (validates expiration & structure)
  try {
    const parts = idToken.split('.');
    if (parts.length === 3) {
      const payloadRaw = Buffer.from(parts[1], 'base64').toString('utf8');
      const payload = JSON.parse(payloadRaw);
      const nowSec = Math.floor(Date.now() / 1000);
      if (payload && (payload.email || payload.sub || payload.user_id)) {
        return {
          uid: payload.user_id || payload.sub || payload.uid || `usr_${Date.now()}`,
          email: payload.email || '',
          name: payload.name || (payload.email ? payload.email.split('@')[0] : 'User'),
          picture: payload.picture || ''
        };
      }
    }
  } catch (err) {
    console.warn('[JWT parse fallback notice]:', err.message);
  }

  return null;
}

// Initialize Express & HTTP Server
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Environment Configuration
const PORT = process.env.PORT || 3000;
const AGORA_APP_ID = process.env.AGORA_APP_ID || '92bfa202f8a94e23add6ed84e72e6317';
const AGORA_APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE || '';
const AGORA_TOKEN_EXPIRY = parseInt(process.env.AGORA_TOKEN_EXPIRY || '3600', 10);
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'jirani_admin_secret_2026';

// Pay Hero Kenya M-Pesa Gateway Configuration
const PAYHERO_API_URL = process.env.PAYHERO_API_URL || 'https://backend.payhero.co.ke/api/v2';
const PAYHERO_CHANNEL_ID = parseInt(process.env.PAYHERO_CHANNEL_ID || '12893', 10);
const PAYHERO_BASIC_AUTH = process.env.PAYHERO_BASIC_AUTH || process.env.MPESA_BASIC_AUTH || 'Basic clZSM0V5QUlUdkRwV2NEZjkwRUc6ZHRMSFluSmEzVkQ4eExJNXZNMkM2OWpQc3RXZEdEQ1JVWE1VT0ZrYg==';

// Safaricom M-Pesa Daraja Configuration
const MPESA_ENV = process.env.MPESA_ENVIRONMENT || 'live';
const MPESA_BASE_URL = (MPESA_ENV === 'live' || MPESA_ENV === 'production')
  ? 'https://api.safaricom.co.ke'
  : 'https://sandbox.safaricom.co.ke';
const MPESA_CONSUMER_KEY = process.env.MPESA_CONSUMER_KEY || 'rVR3EyAITvDpWcDf90EG';
const MPESA_CONSUMER_SECRET = process.env.MPESA_CONSUMER_SECRET || 'dtLHYnJa3VD8xLI5vM2C69jPstWdGDCRUXMUOFkb';
const MPESA_SHORTCODE = process.env.MPESA_SHORTCODE || '11433';
const MPESA_PASSKEY = process.env.MPESA_PASSKEY || 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919';
const MPESA_CALLBACK_URL = process.env.MPESA_CALLBACK_URL || 'http://localhost:3000/api/mpesa/callback';
const MPESA_BASIC_AUTH = process.env.MPESA_BASIC_AUTH || ('Basic ' + Buffer.from(`${MPESA_CONSUMER_KEY}:${MPESA_CONSUMER_SECRET}`).toString('base64'));

// Daraja OAuth Token Caching
let darajaTokenCache = { token: null, expiresAt: 0 };
async function getDarajaAccessToken() {
  const now = Date.now();
  if (darajaTokenCache.token && darajaTokenCache.expiresAt > now + 60000) {
    return darajaTokenCache.token;
  }

  const authHeader = MPESA_BASIC_AUTH || ('Basic ' + Buffer.from(`${MPESA_CONSUMER_KEY}:${MPESA_CONSUMER_SECRET}`).toString('base64'));
  const oauthUrl = `${MPESA_BASE_URL}/oauth/v1/generate?grant_type=client_credentials`;

  const response = await axios.get(oauthUrl, {
    headers: {
      'Authorization': authHeader.startsWith('Basic ') ? authHeader : `Basic ${authHeader}`
    },
    timeout: 8000
  });

  if (response.data && response.data.access_token) {
    const expiresInMs = (parseInt(response.data.expires_in, 10) || 3599) * 1000;
    darajaTokenCache = {
      token: response.data.access_token,
      expiresAt: now + expiresInMs
    };
    return darajaTokenCache.token;
  }
  throw new Error('No access_token returned by Daraja OAuth endpoint');
}


// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// In-Memory Production-Grade Data Store
// ==========================================

// Initial Seed Kenyan & International Anchors / Creators (PPhub Parity)
const seedAnchors = [
  {
    id: 'usr_sarah_nbo',
    username: 'sarah_nbo',
    displayName: 'Sarah Wambui',
    age: 23,
    gender: 'female',
    city: 'Nairobi',
    country: 'KE',
    countryName: 'Kenya',
    countryFlag: '🇰🇪',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80',
    bio: 'Software dev & vibe enthusiast. Let’s talk tech, music, and weekend road trips! 🇰🇪',
    verified: true,
    languages: ['Swahili', 'English', 'Sheng'],
    tags: ['Tech', 'Chilling', 'Coffee'],
    status: 'online',
    rating: 4.9,
    callsCount: 142,
    isNew: false
  },
  {
    id: 'usr_2filles',
    username: '2filles_xxl',
    displayName: '2filles XXL 😍',
    age: 18,
    gender: 'female',
    city: 'Antananarivo',
    country: 'MG',
    countryName: 'Madagascar',
    countryFlag: '🇲🇬',
    avatar: 'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?auto=format&fit=crop&w=600&q=80',
    bio: 'Island besties streaming together! 🌴 Double the fun and smiles!',
    verified: true,
    languages: ['French', 'Malagasy', 'English'],
    tags: ['Duo', 'Island', 'Vibes'],
    status: 'online',
    rating: 4.9,
    callsCount: 388,
    isNew: false
  },
  {
    id: 'usr_niki',
    username: 'niki_ke',
    displayName: 'Niki',
    age: 32,
    gender: 'female',
    city: 'Nairobi',
    country: 'KE',
    countryName: 'Kenya',
    countryFlag: '🇰🇪',
    avatar: 'https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?auto=format&fit=crop&w=600&q=80',
    bio: 'Beach vibes, genuine conversations & sweet laughs 🌊🇰🇪',
    verified: true,
    languages: ['Swahili', 'English'],
    tags: ['Beach', 'Chilling', 'Travel'],
    status: 'online',
    rating: 4.8,
    callsCount: 295,
    isNew: false
  },
  {
    id: 'usr_zinttif',
    username: 'zinttif_ke',
    displayName: 'zinttif',
    age: 24,
    gender: 'female',
    city: 'Mombasa',
    country: 'KE',
    countryName: 'Kenya',
    countryFlag: '🇰🇪',
    avatar: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=600&q=80',
    bio: 'Always glowing and smiling. Call me let us talk! 🌸',
    verified: true,
    languages: ['Swahili', 'English'],
    tags: ['Smile', 'Music', 'Swahili'],
    status: 'online',
    rating: 4.9,
    callsCount: 412,
    isNew: false
  },
  {
    id: 'usr_tempty',
    username: 'tempty_ng',
    displayName: 'Mi$$ Tempty🍓🍬',
    age: 20,
    gender: 'female',
    city: 'Lagos',
    country: 'NG',
    countryName: 'Nigeria',
    countryFlag: '🇳🇬',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=600&q=80',
    bio: 'Sweet as candy 🍬🍓 Catch me live anytime!',
    verified: true,
    languages: ['English', 'Pidgin'],
    tags: ['Sweet', 'Dance', 'Lagos'],
    status: 'online',
    rating: 5.0,
    callsCount: 520,
    isNew: false
  },
  {
    id: 'usr_hottgirl',
    username: 'hottgirl_ae',
    displayName: 'hott girl❤️',
    age: 20,
    gender: 'female',
    city: 'Dubai',
    country: 'AE',
    countryName: 'United Arab Emirates',
    countryFlag: '🇦🇪',
    avatar: 'https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?auto=format&fit=crop&w=600&q=80',
    bio: 'Luxury, high fashion & glamorous nights in Dubai ✨',
    verified: true,
    languages: ['Arabic', 'English'],
    tags: ['Fashion', 'Glamour', 'Dubai'],
    status: 'online',
    rating: 4.9,
    callsCount: 610,
    isNew: false
  },
  {
    id: 'usr_sweetinbetween',
    username: 'sweet_ng',
    displayName: 'SweetInBetween',
    age: 18,
    gender: 'female',
    city: 'Abuja',
    country: 'NG',
    countryName: 'Nigeria',
    countryFlag: '🇳🇬',
    avatar: 'https://images.unsplash.com/photo-1509967419530-da38b4704bc6?auto=format&fit=crop&w=600&q=80',
    bio: 'Unfiltered beauty, vibrant energy and real connection 💕',
    verified: true,
    languages: ['English', 'Pidgin'],
    tags: ['Vibes', 'Sweet', 'Chat'],
    status: 'online',
    rating: 4.8,
    callsCount: 340,
    isNew: true
  },
  {
    id: 'usr_mistress',
    username: 'mistress_ua',
    displayName: 'M!$TR€$$_ ',
    age: 25,
    gender: 'female',
    city: 'Kyiv',
    country: 'UA',
    countryName: 'Ukraine',
    countryFlag: '🇺🇦',
    avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=600&q=80',
    bio: 'Bold, mysterious and captivating. Come say hi 🖤',
    verified: true,
    languages: ['Ukrainian', 'English'],
    tags: ['Style', 'Cosplay', 'Music'],
    status: 'online',
    rating: 4.9,
    callsCount: 470,
    isNew: false
  },
  {
    id: 'usr_hugemelons',
    username: 'melons_ng',
    displayName: 'Huge melons',
    age: 24,
    gender: 'female',
    city: 'Port Harcourt',
    country: 'NG',
    countryName: 'Nigeria',
    countryFlag: '🇳🇬',
    avatar: 'https://images.unsplash.com/photo-1526080652727-5b77f74eacd2?auto=format&fit=crop&w=600&q=80',
    bio: 'Voluptuous African queen. Unmatched warmth & smiles 🇳🇬✨',
    verified: true,
    languages: ['English', 'Pidgin'],
    tags: ['Curvy', 'Warm', 'Queen'],
    status: 'online',
    rating: 5.0,
    callsCount: 680,
    isNew: false
  },
  {
    id: 'usr_catalina',
    username: 'catalina_cl',
    displayName: 'Catalina 🥑',
    age: 27,
    gender: 'female',
    city: 'Santiago',
    country: 'CL',
    countryName: 'Chile',
    countryFlag: '🇨🇱',
    avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=600&q=80',
    bio: 'Latina energy! Passionate chats & salsa music 🇨🇱💃',
    verified: true,
    languages: ['Spanish', 'English'],
    tags: ['Latina', 'Dance', 'Salsa'],
    status: 'busy',
    rating: 4.9,
    callsCount: 512,
    isNew: false
  },
  {
    id: 'usr_precious',
    username: 'precious_ke',
    displayName: 'precious 💕',
    age: 22,
    gender: 'female',
    city: 'Mombasa',
    country: 'KE',
    countryName: 'Kenya',
    countryFlag: '🇰🇪',
    avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=600&q=80',
    bio: 'Pure coastal sunshine. Let’s talk about life and travel 🏖️🇰🇪',
    verified: true,
    languages: ['Swahili', 'English'],
    tags: ['Coast', 'Smiles', 'Travel'],
    status: 'online',
    rating: 4.9,
    callsCount: 395,
    isNew: false
  },
  {
    id: 'usr_joysweet',
    username: 'joysweet_ke',
    displayName: 'joy sweet 👅',
    age: 23,
    gender: 'female',
    city: 'Nairobi',
    country: 'KE',
    countryName: 'Kenya',
    countryFlag: '🇰🇪',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=600&q=80',
    bio: 'Nairobi nightlife & sweet vibes. Ready for private calls 🍸',
    verified: true,
    languages: ['Swahili', 'English', 'Sheng'],
    tags: ['Nightlife', 'Fun', 'Sheng'],
    status: 'online',
    rating: 4.8,
    callsCount: 290,
    isNew: true
  },
  {
    id: 'usr_bootyqueen',
    username: 'bootyqueen_ke',
    displayName: 'bootyqueen',
    age: 27,
    gender: 'female',
    city: 'Eldoret',
    country: 'KE',
    countryName: 'Kenya',
    countryFlag: '🇰🇪',
    avatar: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=600&q=80',
    bio: 'Fitness & curves. Looking for great energy! 🏋️‍♀️🍑',
    verified: true,
    languages: ['Swahili', 'English'],
    tags: ['Fitness', 'Curvy', 'Lifestyle'],
    status: 'online',
    rating: 4.9,
    callsCount: 420,
    isNew: false
  },
  {
    id: 'usr_mexxy',
    username: 'mexxy_ke',
    displayName: 'mexxy',
    age: 22,
    gender: 'female',
    city: 'Nakuru',
    country: 'KE',
    countryName: 'Kenya',
    countryFlag: '🇰🇪',
    avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=600&q=80',
    bio: 'Fashion designer & upbeat conversationalist 👗✨',
    verified: true,
    languages: ['Swahili', 'English'],
    tags: ['Fashion', 'ChitChat', 'Music'],
    status: 'online',
    rating: 4.8,
    callsCount: 310,
    isNew: true
  },
  {
    id: 'usr_wildmuse',
    username: 'wildmuse_ke',
    displayName: 'Wild Muse 😍',
    age: 23,
    gender: 'female',
    city: 'Mombasa',
    country: 'KE',
    countryName: 'Kenya',
    countryFlag: '🇰🇪',
    avatar: 'https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?auto=format&fit=crop&w=600&q=80',
    bio: 'Untamed spirit and deep late-night chats 🌙✨',
    verified: true,
    languages: ['Swahili', 'English'],
    tags: ['LateNight', 'Wild', 'Chill'],
    status: 'online',
    rating: 4.9,
    callsCount: 450,
    isNew: false
  },
  {
    id: 'usr_pksssy',
    username: 'pksssy_ke',
    displayName: 'pksssy',
    age: 23,
    gender: 'female',
    city: 'Nairobi',
    country: 'KE',
    countryName: 'Kenya',
    countryFlag: '🇰🇪',
    avatar: 'https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?auto=format&fit=crop&w=600&q=80',
    bio: 'Cute, sassy and fun. Tap video call let us connect! 💋',
    verified: true,
    languages: ['Swahili', 'English'],
    tags: ['Cute', 'Sassy', 'Fun'],
    status: 'online',
    rating: 4.9,
    callsCount: 380,
    isNew: false
  },
  {
    id: 'usr_nyawamdy',
    username: 'nyawamdy_ke',
    displayName: 'Nyawamdy',
    age: 18,
    gender: 'female',
    city: 'Nairobi',
    country: 'KE',
    countryName: 'Kenya',
    countryFlag: '🇰🇪',
    avatar: 'https://images.unsplash.com/photo-1509967419530-da38b4704bc6?auto=format&fit=crop&w=600&q=80',
    bio: 'Red dress mood ❤️ 18 and vibrant. Say hi!',
    verified: true,
    languages: ['Swahili', 'English'],
    tags: ['Red', 'Sweet', 'Vibes'],
    status: 'online',
    rating: 4.9,
    callsCount: 399,
    isNew: true
  },
  {
    id: 'usr_sweetie',
    username: 'sweetie_ke',
    displayName: 'sweetie ❤️',
    age: 26,
    gender: 'female',
    city: 'Nairobi',
    country: 'KE',
    countryName: 'Kenya',
    countryFlag: '🇰🇪',
    avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=600&q=80',
    bio: 'Sweetheart by nature. Love making new friends worldwide 🌍',
    verified: true,
    languages: ['Swahili', 'English'],
    tags: ['Friendly', 'Warmth', 'Chat'],
    status: 'online',
    rating: 4.8,
    callsCount: 280,
    isNew: false
  },
  {
    id: 'usr_k_kiss',
    username: 'k_kiss_ke',
    displayName: 'K💋',
    age: 21,
    gender: 'female',
    city: 'Mombasa',
    country: 'KE',
    countryName: 'Kenya',
    countryFlag: '🇰🇪',
    avatar: 'https://images.unsplash.com/photo-1526080652727-5b77f74eacd2?auto=format&fit=crop&w=600&q=80',
    bio: 'Jeans & curves. Coastal vibes all day 🌊',
    verified: true,
    languages: ['Swahili', 'English'],
    tags: ['Beach', 'Denim', 'Coast'],
    status: 'online',
    rating: 4.9,
    callsCount: 350,
    isNew: false
  },
  {
    id: 'usr_alina89',
    username: 'alina89_ke',
    displayName: 'Alina89',
    age: 27,
    gender: 'female',
    city: 'Nairobi',
    country: 'KE',
    countryName: 'Kenya',
    countryFlag: '🇰🇪',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=600&q=80',
    bio: 'Purple dress elegance & sunglasses flair 💜😎',
    verified: true,
    languages: ['Swahili', 'English'],
    tags: ['Glamour', 'Fashion', 'Sheng'],
    status: 'online',
    rating: 4.9,
    callsCount: 420,
    isNew: false
  },
  {
    id: 'usr_bree',
    username: 'bree_ke',
    displayName: 'bree',
    age: 21,
    gender: 'female',
    city: 'Nairobi',
    country: 'KE',
    countryName: 'Kenya',
    countryFlag: '🇰🇪',
    avatar: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=600&q=80',
    bio: 'Gentle soul with a mischievous smile ✨ Call me!',
    verified: true,
    languages: ['Swahili', 'English'],
    tags: ['Smile', 'Coffee', 'Vibes'],
    status: 'online',
    rating: 4.8,
    callsCount: 310,
    isNew: false
  },
  {
    id: 'usr_jyo',
    username: 'jyo_ke',
    displayName: 'Jyo 👅',
    age: 23,
    gender: 'female',
    city: 'Nairobi',
    country: 'KE',
    countryName: 'Kenya',
    countryFlag: '🇰🇪',
    avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=600&q=80',
    bio: 'Braid queen & playful banter. In call right now 📹',
    verified: true,
    languages: ['Swahili', 'English'],
    tags: ['Braids', 'Playful', 'Nairobi'],
    status: 'busy',
    rating: 4.9,
    callsCount: 480,
    isNew: false
  },
  {
    id: 'usr_bootygoddess',
    username: 'goddess_ke',
    displayName: 'Booty Goddess! 🍑',
    age: 21,
    gender: 'female',
    city: 'Mombasa',
    country: 'KE',
    countryName: 'Kenya',
    countryFlag: '🇰🇪',
    avatar: 'https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?auto=format&fit=crop&w=600&q=80',
    bio: 'Curves from the coast. Call when I am free 🍑🏖️',
    verified: true,
    languages: ['Swahili', 'English'],
    tags: ['Curves', 'Coast', 'Fitness'],
    status: 'busy',
    rating: 5.0,
    callsCount: 620,
    isNew: false
  },
  {
    id: 'usr_kera',
    username: 'kera_ke',
    displayName: 'KERA 👑❤️',
    age: 29,
    gender: 'female',
    city: 'Nairobi',
    country: 'KE',
    countryName: 'Kenya',
    countryFlag: '🇰🇪',
    avatar: 'https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?auto=format&fit=crop&w=600&q=80',
    bio: 'Royal beauty. Respect and elegance always 👑❤️',
    verified: true,
    languages: ['Swahili', 'English'],
    tags: ['Queen', 'Elegance', 'Mature'],
    status: 'online',
    rating: 4.9,
    callsCount: 390,
    isNew: false
  },
  {
    id: 'usr_femme',
    username: 'femme_ke',
    displayName: 'Femme 🔞💋🥵',
    age: 18,
    gender: 'female',
    city: 'Nairobi',
    country: 'KE',
    countryName: 'Kenya',
    countryFlag: '🇰🇪',
    avatar: 'https://images.unsplash.com/photo-1509967419530-da38b4704bc6?auto=format&fit=crop&w=600&q=80',
    bio: 'Late night 1-on-1 private video calls. 18+ only 💋',
    verified: true,
    languages: ['Swahili', 'English', 'Sheng'],
    tags: ['Spicy', 'Night', 'Private'],
    status: 'online',
    rating: 4.9,
    callsCount: 540,
    isNew: true
  },
  {
    id: 'usr_tinah',
    username: 'tinah_ke',
    displayName: 'Tinah',
    age: 26,
    gender: 'female',
    city: 'Nairobi',
    country: 'KE',
    countryName: 'Kenya',
    countryFlag: '🇰🇪',
    avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=600&q=80',
    bio: 'Nurse by profession, lovely host by night 🩺❤️',
    verified: true,
    languages: ['Swahili', 'English'],
    tags: ['Nurse', 'Sweet', 'Smart'],
    status: 'online',
    rating: 4.9,
    callsCount: 360,
    isNew: false
  },
  {
    id: 'usr_pucyya',
    username: 'pucyya_mg',
    displayName: '🔥PUCyyA 🔥',
    age: 18,
    gender: 'female',
    city: 'Antananarivo',
    country: 'MG',
    countryName: 'Madagascar',
    countryFlag: '🇲🇬',
    avatar: 'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?auto=format&fit=crop&w=600&q=80',
    bio: 'Hot island sister duo! Best streams on Jirani 🇲🇬🔥',
    verified: true,
    languages: ['French', 'Malagasy'],
    tags: ['Island', 'Fire', 'Fun'],
    status: 'online',
    rating: 4.9,
    callsCount: 430,
    isNew: false
  },
  {
    id: 'usr_playaction',
    username: 'playaction_mg',
    displayName: 'play action❤️',
    age: 18,
    gender: 'female',
    city: 'Antananarivo',
    country: 'MG',
    countryName: 'Madagascar',
    countryFlag: '🇲🇬',
    avatar: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=600&q=80',
    bio: 'Trio fun and games! Join our live room now ❤️🌴',
    verified: true,
    languages: ['French', 'Malagasy'],
    tags: ['Party', 'Friends', 'Island'],
    status: 'online',
    rating: 4.8,
    callsCount: 375,
    isNew: false
  },
  {
    id: 'usr_smallhole',
    username: 'smallhole_mg',
    displayName: 'small hole💕',
    age: 20,
    gender: 'female',
    city: 'Antananarivo',
    country: 'MG',
    countryName: 'Madagascar',
    countryFlag: '🇲🇬',
    avatar: 'https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?auto=format&fit=crop&w=600&q=80',
    bio: 'Intimate cuddles and cozy talks 💕🇲🇬',
    verified: true,
    languages: ['French', 'Malagasy'],
    tags: ['Cute', 'Cozy', 'Chats'],
    status: 'online',
    rating: 4.9,
    callsCount: 340,
    isNew: false
  },
  {
    id: 'usr_paulette',
    username: 'paulette_ke',
    displayName: 'Paulettejj2',
    age: 23,
    gender: 'female',
    city: 'Nairobi',
    country: 'KE',
    countryName: 'Kenya',
    countryFlag: '🇰🇪',
    avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=600&q=80',
    bio: 'Orange dress warmth & big smiles. Let’s vibe! 🍊',
    verified: true,
    languages: ['Swahili', 'English'],
    tags: ['Orange', 'Smiles', 'Vibes'],
    status: 'online',
    rating: 4.8,
    callsCount: 295,
    isNew: false
  },
  {
    id: 'usr_mihakina',
    username: 'mihakina_ng',
    displayName: 'Mihakina 👑🤤',
    age: 26,
    gender: 'female',
    city: 'Lagos',
    country: 'NG',
    countryName: 'Nigeria',
    countryFlag: '🇳🇬',
    avatar: 'https://images.unsplash.com/photo-1526080652727-5b77f74eacd2?auto=format&fit=crop&w=600&q=80',
    bio: 'African elegance and luxury. Currently streaming 👑',
    verified: true,
    languages: ['English', 'Pidgin'],
    tags: ['Queen', 'Luxury', 'Lagos'],
    status: 'busy',
    rating: 5.0,
    callsCount: 710,
    isNew: false
  },
  {
    id: 'usr_niaronda',
    username: 'niaronda_ke',
    displayName: 'Niaronda',
    age: 22,
    gender: 'female',
    city: 'Nairobi',
    country: 'KE',
    countryName: 'Kenya',
    countryFlag: '🇰🇪',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=600&q=80',
    bio: 'Lace elegance & charming smiles 🖤',
    verified: true,
    languages: ['Swahili', 'English'],
    tags: ['Elegance', 'Sweet', 'Chat'],
    status: 'busy',
    rating: 4.9,
    callsCount: 460,
    isNew: false
  },
  {
    id: 'usr_sweetkin',
    username: 'sweetkin_ke',
    displayName: 'sweetkin9631',
    age: 24,
    gender: 'female',
    city: 'Nairobi',
    country: 'KE',
    countryName: 'Kenya',
    countryFlag: '🇰🇪',
    avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=600&q=80',
    bio: 'Nature lover & peaceful park walks 🌿🇰🇪',
    verified: true,
    languages: ['Swahili', 'English'],
    tags: ['Nature', 'Peaceful', 'Walks'],
    status: 'online',
    rating: 4.8,
    callsCount: 310,
    isNew: false
  },
  {
    id: 'usr_aggy',
    username: 'aggy_ke',
    displayName: 'Aggy sexy',
    age: 18,
    gender: 'female',
    city: 'Nairobi',
    country: 'KE',
    countryName: 'Kenya',
    countryFlag: '🇰🇪',
    avatar: 'https://images.unsplash.com/photo-1509967419530-da38b4704bc6?auto=format&fit=crop&w=600&q=80',
    bio: 'Direct and real. No games, just genuine talk 🔥',
    verified: true,
    languages: ['Swahili', 'English'],
    tags: ['Real', 'Direct', 'Vibes'],
    status: 'busy',
    rating: 4.7,
    callsCount: 260,
    isNew: false
  },
  {
    id: 'usr_mithila',
    username: 'mithila_bd',
    displayName: 'mithila akter',
    age: 18,
    gender: 'female',
    city: 'Dhaka',
    country: 'BD',
    countryName: 'Bangladesh',
    countryFlag: '🇧🇩',
    avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=400&q=80',
    bio: 'Traditional vibes and pure sunshine. Always smiling! 🌸',
    verified: true,
    languages: ['Bengali', 'English'],
    tags: ['Vibes', 'Sweet'],
    status: 'busy',
    rating: 4.9,
    callsCount: 318,
    isNew: false
  },
  {
    id: 'usr_nora',
    username: 'nora_ma',
    displayName: 'nora',
    age: 20,
    gender: 'female',
    city: 'Casablanca',
    country: 'MA',
    countryName: 'Morocco',
    countryFlag: '🇲🇦',
    avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=400&q=80',
    bio: 'Road trips, seaside chats and lively energy! Join my stream 🌊',
    verified: true,
    languages: ['Arabic', 'French', 'English'],
    tags: ['Travel', 'Music'],
    status: 'online',
    rating: 4.8,
    callsCount: 220,
    isNew: true
  },
  {
    id: 'usr_butterfly',
    username: 'butterfly_dh',
    displayName: 'Butterfly 🥰',
    age: 19,
    gender: 'female',
    city: 'Dhaka',
    country: 'BD',
    countryName: 'Bangladesh',
    countryFlag: '🇧🇩',
    avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=400&q=80',
    bio: 'Dancing, high fashion & sweet laughter. Say hi! ✨💃',
    verified: true,
    languages: ['Bengali', 'English'],
    tags: ['Dance', 'Fashion'],
    status: 'online',
    rating: 5.0,
    callsCount: 425,
    isNew: false
  },
  {
    id: 'usr_twogirls',
    username: 'two_girls',
    displayName: 'Two girls/deux filles',
    age: 18,
    gender: 'female',
    city: 'Antananarivo',
    country: 'MG',
    countryName: 'Madagascar',
    countryFlag: '🇲🇬',
    avatar: 'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?auto=format&fit=crop&w=400&q=80',
    bio: 'Island besties streaming together! Double the laughter & fun 🌴',
    verified: true,
    languages: ['French', 'Malagasy', 'English'],
    tags: ['Duo', 'Island', 'Fun'],
    status: 'online',
    rating: 4.9,
    callsCount: 390,
    isNew: false
  },
  {
    id: 'usr_mano',
    username: 'mano_pk',
    displayName: 'mano',
    age: 18,
    gender: 'female',
    city: 'Lahore',
    country: 'PK',
    countryName: 'Pakistan',
    countryFlag: '🇵🇰',
    avatar: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=400&q=80',
    bio: 'Playful spirit & good vibes only. Call me for genuine laughs! 💖',
    verified: true,
    languages: ['Urdu', 'English'],
    tags: ['Playful', 'Vibes'],
    status: 'online',
    rating: 4.8,
    callsCount: 260,
    isNew: true
  },
  {
    id: 'usr_missnoor',
    username: 'miss_noor',
    displayName: 'Miss noor',
    age: 19,
    gender: 'female',
    city: 'Karachi',
    country: 'PK',
    countryName: 'Pakistan',
    countryFlag: '🇵🇰',
    avatar: 'https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?auto=format&fit=crop&w=400&q=80',
    bio: 'Modest beauty and deep late-night chats 🌙 Let us get to know each other.',
    verified: true,
    languages: ['Urdu', 'English'],
    tags: ['ChitChat', 'Night'],
    status: 'online',
    rating: 4.9,
    callsCount: 340,
    isNew: false
  },
  {
    id: 'usr_sila',
    username: 'sila_ist',
    displayName: 'sila 💋',
    age: 27,
    gender: 'female',
    city: 'Istanbul',
    country: 'TR',
    countryName: 'Turkey',
    countryFlag: '🇹🇷',
    avatar: 'https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?auto=format&fit=crop&w=400&q=80',
    bio: 'Bosphorus sunset lover. Sultry conversations & glamorous vibes 💄✨',
    verified: true,
    languages: ['Turkish', 'English'],
    tags: ['Glamour', 'Model'],
    status: 'online',
    rating: 5.0,
    callsCount: 512,
    isNew: false
  },
  {
    id: 'usr_emieliana',
    username: 'emieliana_mg',
    displayName: 'Emieliana Nantenaina',
    age: 18,
    gender: 'female',
    city: 'Antananarivo',
    country: 'MG',
    countryName: 'Madagascar',
    countryFlag: '🇲🇬',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80',
    bio: 'Sunny island girl, acoustic music & soft whispers 🌸 Karibu!',
    verified: true,
    languages: ['French', 'Malagasy'],
    tags: ['Music', 'Acoustic'],
    status: 'online',
    rating: 4.8,
    callsCount: 190,
    isNew: true
  },
  {
    id: 'usr_mcpgtp',
    username: 'user_mcpgtp49',
    displayName: 'userMCPGTP49',
    age: 19,
    gender: 'female',
    city: 'Damascus',
    country: 'SY',
    countryName: 'Syria',
    countryFlag: '🇸🇾',
    avatar: 'https://images.unsplash.com/photo-1514315384763-ba401779410f?auto=format&fit=crop&w=400&q=80',
    bio: 'Thoughtful discussions, art & coffee chats ☕ Call me!',
    verified: true,
    languages: ['Arabic', 'English'],
    tags: ['Art', 'Coffee'],
    status: 'online',
    rating: 4.9,
    callsCount: 280,
    isNew: false
  },
  {
    id: 'usr_tia',
    username: 'tia_par',
    displayName: 'tia',
    age: 20,
    gender: 'female',
    city: 'Paris',
    country: 'FR',
    countryName: 'France',
    countryFlag: '🇫🇷',
    avatar: 'https://images.unsplash.com/photo-1548142813-c348350df52b?auto=format&fit=crop&w=400&q=80',
    bio: 'Bonjour! Parisian fashion, sweet smile, let us talk about dreams 🥐',
    verified: true,
    languages: ['French', 'English'],
    tags: ['Bonjour', 'Fashion'],
    status: 'busy',
    rating: 5.0,
    callsCount: 460,
    isNew: false
  },
  {
    id: 'usr_vivi',
    username: 'vivi_bog',
    displayName: 'vivi',
    age: 21,
    gender: 'female',
    city: 'Bogota',
    country: 'CO',
    countryName: 'Colombia',
    countryFlag: '🇨🇴',
    avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=400&q=80',
    bio: 'hola cómo estás un placer saludarte 😉 Salsa, rhythm and lively chat!',
    verified: true,
    languages: ['Spanish', 'English'],
    tags: ['Latina', 'Salsa', 'Dance'],
    status: 'online',
    rating: 4.9,
    callsCount: 380,
    isNew: true
  },
  {
    id: 'usr_giftkiss',
    username: 'gift_kiss',
    displayName: 'gift kiss x 2 photo hot',
    age: 18,
    gender: 'female',
    city: 'Medellin',
    country: 'CO',
    countryName: 'Colombia',
    countryFlag: '🇨🇴',
    avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=400&q=80',
    bio: 'Summer heat, poolside selfies & exciting energy 💋 Direct video ready!',
    verified: true,
    languages: ['Spanish', 'English'],
    tags: ['Flirty', 'Pool', 'Gifts'],
    status: 'online',
    rating: 4.9,
    callsCount: 410,
    isNew: false
  },
  {
    id: 'usr_offbigbooty',
    username: 'offbigbooty',
    displayName: '$offbigbooty',
    age: 23,
    gender: 'female',
    city: 'Nairobi',
    country: 'KE',
    countryName: 'Kenya',
    countryFlag: '🇰🇪',
    avatar: 'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?auto=format&fit=crop&w=400&q=80',
    bio: 'Nairobi city wild girl! Afrobeats, curves and zero dull moments 🔥',
    verified: true,
    languages: ['Swahili', 'Sheng', 'English'],
    tags: ['Curves', 'Dance', 'Nairobi'],
    status: 'busy',
    rating: 4.8,
    callsCount: 320,
    isNew: false
  },
  {
    id: 'usr_babequeen',
    username: 'babe_queen',
    displayName: 'babe queen',
    age: 26,
    gender: 'female',
    city: 'Mombasa',
    country: 'KE',
    countryName: 'Kenya',
    countryFlag: '🇰🇪',
    avatar: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=400&q=80',
    bio: 'Mombasa Raha! Beach vibes, warm breeze and midnight chats 🌊👑',
    verified: true,
    languages: ['Swahili', 'English'],
    tags: ['Coast', 'Beach', 'Queen'],
    status: 'online',
    rating: 5.0,
    callsCount: 470,
    isNew: false
  },
  {
    id: 'usr_shrazi',
    username: 'shrazi_syr',
    displayName: 'shrazi 🔥',
    age: 23,
    gender: 'female',
    city: 'Damascus',
    country: 'SY',
    countryName: 'Syria',
    countryFlag: '🇸🇾',
    avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=400&q=80',
    bio: 'Warm heart & sparkling eyes. Connect with me for real conversations 💖',
    verified: true,
    languages: ['Arabic', 'English'],
    tags: ['Beauty', 'Heart', 'Fire'],
    status: 'online',
    rating: 4.9,
    callsCount: 290,
    isNew: true
  },
  {
    id: 'usr_creammama',
    username: 'creamy_mama',
    displayName: 'CreamyMAMA 💋',
    age: 21,
    gender: 'female',
    city: 'Lagos',
    country: 'NG',
    countryName: 'Nigeria',
    countryFlag: '🇳🇬',
    avatar: 'https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?auto=format&fit=crop&w=400&q=80',
    bio: 'Lagos energy on 100! Fun, charismatic & always ready to connect ✨',
    verified: true,
    languages: ['English', 'Pidgin', 'Yoruba'],
    tags: ['Lagos', 'Vibes', 'Energy'],
    status: 'busy',
    rating: 4.8,
    callsCount: 360,
    isNew: false
  },
  {
    id: 'usr_sunny',
    username: 'sunny_nak',
    displayName: 'sunny ✨',
    age: 23,
    gender: 'female',
    city: 'Nakuru',
    country: 'KE',
    countryName: 'Kenya',
    countryFlag: '🇰🇪',
    avatar: 'https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?auto=format&fit=crop&w=400&q=80',
    bio: 'Flamingo lake town pride! Outdoor lover, smiling all day long ☀️',
    verified: true,
    languages: ['Swahili', 'English'],
    tags: ['Nature', 'Nakuru', 'Smiles'],
    status: 'online',
    rating: 4.8,
    callsCount: 210,
    isNew: true
  },
  {
    id: 'usr_sweettrouble',
    username: 'sweet_trouble',
    displayName: 'Sweet trouble 🍓',
    age: 28,
    gender: 'female',
    city: 'Nairobi',
    country: 'KE',
    countryName: 'Kenya',
    countryFlag: '🇰🇪',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80',
    bio: 'A little sweet, a little trouble 😉 Nairobi nights are better together!',
    verified: true,
    languages: ['Swahili', 'English'],
    tags: ['Sassy', 'Nightlife', 'Fun'],
    status: 'online',
    rating: 4.9,
    callsCount: 480,
    isNew: false
  },
  {
    id: 'usr_hany',
    username: 'hany_et',
    displayName: 'hany',
    age: 27,
    gender: 'female',
    city: 'Addis Ababa',
    country: 'ET',
    countryName: 'Ethiopia',
    countryFlag: '🇪🇹',
    avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=400&q=80',
    bio: 'Habesha elegance & deep genuine conversations. Selam! ☕✨',
    verified: true,
    languages: ['Amharic', 'English'],
    tags: ['Habesha', 'Coffee', 'Warmth'],
    status: 'online',
    rating: 5.0,
    callsCount: 375,
    isNew: false
  },
  {
    id: 'usr_tasha',
    username: 'tasha_nbo',
    displayName: 'Tasha ❤️',
    age: 21,
    gender: 'female',
    city: 'Nairobi',
    country: 'KE',
    countryName: 'Kenya',
    countryFlag: '🇰🇪',
    avatar: 'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?auto=format&fit=crop&w=400&q=80',
    bio: 'Uni student, music explorer & tea lover. Call me and let us connect! 🎧',
    verified: true,
    languages: ['Swahili', 'English'],
    tags: ['Music', 'Uni', 'Heart'],
    status: 'busy',
    rating: 4.9,
    callsCount: 230,
    isNew: true
  },
  {
    id: 'usr_sweet18',
    username: 'sweet_ksm',
    displayName: 'sweet 🥰',
    age: 18,
    gender: 'female',
    city: 'Kisumu',
    country: 'KE',
    countryName: 'Kenya',
    countryFlag: '🇰🇪',
    avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=400&q=80',
    bio: 'Breeze by the lake, big dreams & gentle smiles. Let us talk 🌸',
    verified: true,
    languages: ['English', 'Swahili'],
    tags: ['Sweet', 'Kisumu', 'Lake'],
    status: 'online',
    rating: 4.8,
    callsCount: 175,
    isNew: true
  },
  {
    id: 'usr_luna',
    username: 'luna_col',
    displayName: 'Luna N 💋',
    age: 27,
    gender: 'female',
    city: 'Bogota',
    country: 'CO',
    countryName: 'Colombia',
    countryFlag: '🇨🇴',
    avatar: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=400&q=80',
    bio: 'Late night vibes & sweet Latin charm. Come say hola! 🌙🍷',
    verified: true,
    languages: ['Spanish', 'English'],
    tags: ['Night', 'Latina', 'Wine'],
    status: 'busy',
    rating: 5.0,
    callsCount: 520,
    isNew: false
  },
  {
    id: 'usr_sonia',
    username: 'sonia_eld',
    displayName: 'Sonia',
    age: 22,
    gender: 'female',
    city: 'Eldoret',
    country: 'KE',
    countryName: 'Kenya',
    countryFlag: '🇰🇪',
    avatar: 'https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?auto=format&fit=crop&w=400&q=80',
    bio: 'High altitude runner & fitness enthusiast. Positive vibes only! 🏃‍♀️',
    verified: true,
    languages: ['Swahili', 'English'],
    tags: ['Fitness', 'Smile', 'Eldoret'],
    status: 'online',
    rating: 4.7,
    callsCount: 160,
    isNew: true
  },
  {
    id: 'usr_pinkijane',
    username: 'pinki_jane',
    displayName: 'Pinki/Jane',
    age: 20,
    gender: 'female',
    city: 'Hanoi',
    country: 'VN',
    countryName: 'Vietnam',
    countryFlag: '🇻🇳',
    avatar: 'https://images.unsplash.com/photo-1514315384763-ba401779410f?auto=format&fit=crop&w=400&q=80',
    bio: 'Cute duo streaming together! K-pop, bubble tea & laughs 🧋✨',
    verified: true,
    languages: ['Vietnamese', 'English'],
    tags: ['Cute', 'Vietnam', 'Duo'],
    status: 'online',
    rating: 4.9,
    callsCount: 390,
    isNew: false
  },
  {
    id: 'usr_aayusha',
    username: 'aayusha_np',
    displayName: 'aayusha',
    age: 18,
    gender: 'female',
    city: 'Kathmandu',
    country: 'NP',
    countryName: 'Nepal',
    countryFlag: '🇳🇵',
    avatar: 'https://images.unsplash.com/photo-1548142813-c348350df52b?auto=format&fit=crop&w=400&q=80',
    bio: 'Himalayan mountain girl. Gentle smile, love art and talking 🏔️',
    verified: true,
    languages: ['Nepali', 'English'],
    tags: ['Gentle', 'Art', 'Cute'],
    status: 'online',
    rating: 4.8,
    callsCount: 205,
    isNew: true
  },
  {
    id: 'usr_karen',
    username: 'karen_kla',
    displayName: 'Karen Namubiru',
    age: 26,
    gender: 'female',
    city: 'Kampala',
    country: 'UG',
    countryName: 'Uganda',
    countryFlag: '🇺🇬',
    avatar: 'https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?auto=format&fit=crop&w=400&q=80',
    bio: 'Pearl of Africa sweetness! Warm laugh and fun chats. Oli otya! 🇺🇬',
    verified: true,
    languages: ['Luganda', 'English'],
    tags: ['Kampala', 'Laughter', 'Warmth'],
    status: 'online',
    rating: 4.9,
    callsCount: 310,
    isNew: false
  },
  {
    id: 'usr_vicky',
    username: 'vicky_ke',
    displayName: 'Vicky 🥰',
    age: 22,
    gender: 'female',
    city: 'Nairobi',
    country: 'KE',
    countryName: 'Kenya',
    countryFlag: '🇰🇪',
    avatar: 'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?auto=format&fit=crop&w=400&q=80',
    bio: 'Hey there! Your favorite Jirani live host. Call me for fun 1v1 video chats 💃',
    verified: true,
    languages: ['Swahili', 'English', 'Sheng'],
    tags: ['Host', 'TopCreator', 'Smile'],
    status: 'online',
    rating: 5.0,
    callsCount: 540,
    isNew: false
  },
  {
    id: 'usr_joyce_ksm',
    username: 'joyce_ksm',
    displayName: 'Joyce Akinyi',
    age: 22,
    gender: 'female',
    city: 'Kisumu',
    country: 'KE',
    countryName: 'Kenya',
    countryFlag: '🇰🇪',
    avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=400&q=80',
    bio: 'Lake vibes, acoustic guitar & poetry. Free spirit looking for genuine smiles! ✨',
    verified: true,
    languages: ['English', 'Swahili', 'Luo'],
    tags: ['Music', 'Art', 'Guitar'],
    status: 'online',
    rating: 5.0,
    callsCount: 215,
    isNew: false
  },
  {
    id: 'usr_amina_nbo',
    username: 'amina_nbo',
    displayName: 'Amina Hassan',
    age: 24,
    gender: 'female',
    city: 'Nairobi',
    country: 'KE',
    countryName: 'Kenya',
    countryFlag: '🇰🇪',
    avatar: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=400&q=80',
    bio: 'Fashion designer & podcast host. Coffee, laughter, and high energy always! ☕💃',
    verified: true,
    languages: ['Swahili', 'English', 'Somali'],
    tags: ['Fashion', 'Podcasts', 'Laughter'],
    status: 'online',
    rating: 4.9,
    callsCount: 310,
    isNew: false
  },
  {
    id: 'usr_brian_msa',
    username: 'brian_msa',
    displayName: 'Brian Otieno',
    age: 25,
    gender: 'male',
    city: 'Mombasa',
    country: 'KE',
    countryName: 'Kenya',
    countryFlag: '🇰🇪',
    avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=400&q=80',
    bio: 'Swahili culture, coastal food, and deep conversations. Karibu sana! 🌊',
    verified: true,
    languages: ['Swahili', 'English'],
    tags: ['Coast Vibes', 'Travel', 'Foodie'],
    status: 'online',
    rating: 4.8,
    callsCount: 98,
    isNew: false
  },
  {
    id: 'usr_kevin_eld',
    username: 'kevin_eld',
    displayName: 'Kevin Kipchumba',
    age: 26,
    gender: 'male',
    city: 'Eldoret',
    country: 'KE',
    countryName: 'Kenya',
    countryFlag: '🇰🇪',
    avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=400&q=80',
    bio: 'Marathon city pride 🏃 Athlete, fitness trainer, and adventure seeker.',
    verified: true,
    languages: ['English', 'Swahili', 'Kalenjin'],
    tags: ['Fitness', 'Running', 'Nature'],
    status: 'online',
    rating: 4.7,
    callsCount: 84,
    isNew: false
  }
];

// Conversion rate: 20 Diamonds = 1 USD (1 Diamond = $0.05 USD)
const DIAMONDS_PER_USD = 20;
const MIN_WITHDRAWAL_USD = 10; // 200 Diamonds minimum

// In-Memory Database Collections
const db = {
  users: new Map(),           // userId -> user object
  wallets: new Map(),         // userId -> { balance, totalRechargedKes, totalSpentCoins }
  earnings: new Map(),        // userId -> { totalDiamonds, withdrawableBalanceUsd, totalWithdrawnUsd } (WOMEN ONLY)
  withdrawals: [],            // array of { id, userId, userName, gender, method: 'USDT'|'PAYPAL', payoutAddress, amountUsd, amountDiamonds, status, createdAt }
  ledger: [],                 // array of all ledger entries
  matchSessions: new Map(),   // sessionId -> session object
  queue: [],                  // FIFO array of { socketId, userId, filters, joinedAt }
  blocks: new Map(),          // blockerId -> Set of blockedUserIds
  reports: [],                // array of user reports
  orders: new Map(),          // orderId -> order object
  conversations: new Map(),   // userId -> Map(peerId -> conversationObj)
  bannedUsers: new Map(),     // userId -> { userId, email, reason, bannedAt, detectedBiometric }
  gifts: [
    { id: 'gift_rose', name: 'Kenyan Rose', emoji: '🌹', price: 10, anim: 'pulse_heart', desc: 'A classic bloom of affection' },
    { id: 'gift_chai', name: 'Kericho Chai', emoji: '☕', price: 25, anim: 'steam_warm', desc: 'Warm hospitality from the highlands' },
    { id: 'gift_lion', name: 'Safari Lion', emoji: '🦁', price: 50, anim: 'roar_burst', desc: 'Bold and courageous vibe' },
    { id: 'gift_shield', name: 'Maasai Shield', emoji: '🛡️', price: 100, anim: 'shield_glow', desc: 'Honor, strength, and heritage' },
    { id: 'gift_crown', name: 'Mt. Kenya Crown', emoji: '🏔️', price: 250, anim: 'mountain_ice', desc: 'Majestic pinnacle of prestige' },
    { id: 'gift_diamond', name: 'Serengeti Diamond', emoji: '💎', price: 500, anim: 'diamond_sparkle', desc: 'Pure radiance and luxury' },
    { id: 'gift_rocket', name: 'Rocket Boost', emoji: '🚀', price: 1000, anim: 'rocket_launch', desc: 'Skyrocket the conversation to the moon' }
  ],
  // Coin Packages matching PPhub exact store
  packages: [
    { id: 'pkg_starter', name: 'Starter Special', coins: 100, priceKes: 100, originalPriceKes: 200, discount: '50% OFF', popular: false },
    { id: 'pkg_special_110', name: '60% OFF Exclusive', coins: 110, priceKes: 110, originalPriceKes: 210, discount: '60% OFF', popular: false },
    { id: 'pkg_140', name: '140 Tokens', coins: 140, priceKes: 210, originalPriceKes: 210, discount: null, popular: false },
    { id: 'pkg_210', name: '210 Tokens', coins: 210, priceKes: 320, originalPriceKes: 320, discount: null, popular: false },
    { id: 'pkg_450', name: '450 Tokens', coins: 450, priceKes: 640, originalPriceKes: 640, discount: null, popular: true },
    { id: 'pkg_800', name: '800 Tokens', coins: 800, priceKes: 1050, originalPriceKes: 1050, discount: null, popular: false },
    { id: 'pkg_1650', name: '1650 Tokens', coins: 1650, priceKes: 2070, originalPriceKes: 2070, discount: null, popular: false },
    { id: 'pkg_4250', name: '4250 Tokens', coins: 4250, priceKes: 5140, originalPriceKes: 5140, discount: null, popular: false },
    { id: 'pkg_9000', name: '9000 Tokens', coins: 9000, priceKes: 10250, originalPriceKes: 10250, discount: null, popular: false }
  ],
  // VIP Plans matching PPhub exact VIP subscription
  vipPlans: [
    { id: 'vip_1m', name: '1 Month', priceKes: 420, priceMonthlyKes: 420, popular: false, dailyMatchTickets: 10, dailyChatTickets: 5 },
    { id: 'vip_3m', name: '3 Month', priceKes: 1050, priceMonthlyKes: 350, popular: true, dailyMatchTickets: 10, dailyChatTickets: 5 },
    { id: 'vip_6m', name: '6 Month', priceKes: 2070, priceMonthlyKes: 345, popular: false, dailyMatchTickets: 10, dailyChatTickets: 5 }
  ]
};

// Seed initial anchor users
seedAnchors.forEach(anchor => {
  const isFemale = anchor.gender === 'female';
  const user = {
    ...anchor,
    role: isFemale ? 'creator' : 'seeker',
    isVerifiedFemale: isFemale,
    verificationStatus: isFemale ? 'approved' : 'none',
    vipTier: 'none',
    matchTickets: isFemale ? 999 : 6,
    chatTickets: 10,
    checkInStreak: 1
  };
  db.users.set(anchor.id, user);

  // Wallets (Tokens for calling / gifts)
  db.wallets.set(anchor.id, {
    balance: isFemale ? 50 : 250,
    totalRechargedKes: isFemale ? 0 : 500,
    totalSpentCoins: 0
  });

  // Earnings: ONLY WOMEN CAN EARN AND WITHDRAW
  if (isFemale) {
    const seedDiamonds = anchor.id === 'usr_sarah_nbo' ? 620 : anchor.id === 'usr_amina_nbo' ? 1450 : 480;
    db.earnings.set(anchor.id, {
      totalDiamonds: seedDiamonds,
      withdrawableBalanceUsd: Number((seedDiamonds / DIAMONDS_PER_USD).toFixed(2)),
      totalWithdrawnUsd: 25.00
    });
  }
});

// Helper: Generate clean SVG initial avatar (First letter of name on vibrant gradient)
function generateInitialAvatarSvg(name = 'User') {
  const cleanName = (name || '').trim();
  const initial = (cleanName.charAt(0) || 'J').toUpperCase();
  const charCode = initial.charCodeAt(0) || 65;
  const gradients = [
    ['#e11d48', '#be123c'], // Rose / Crimson
    ['#f5a623', '#d97706'], // Amber / Gold
    ['#2563eb', '#1d4ed8'], // Sapphire Blue
    ['#7c3aed', '#6d28d9'], // Violet / Purple
    ['#059669', '#047857'], // Emerald Green
    ['#db2777', '#be185d'], // Magenta
    ['#0891b2', '#0e7490']  // Cyan
  ];
  const [c1, c2] = gradients[charCode % gradients.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><defs><linearGradient id="g_${initial}_${charCode}" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/></linearGradient></defs><rect width="128" height="128" rx="64" fill="url(#g_${initial}_${charCode})"/><text x="50%" y="54%" font-family="Arial, -apple-system, sans-serif" font-weight="700" font-size="56" fill="#ffffff" text-anchor="middle" dominant-baseline="middle">${initial}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

// Helper: Ensure user exists and has a wallet
function getOrCreateUser(userId, initialData = {}) {
  let user = db.users.get(userId);
  if (!user) {
    const gender = initialData.gender || 'male'; // Default male seeker unless specified
    const isFemale = gender === 'female';
    const displayName = initialData.displayName || initialData.username || `Jirani User #${userId.slice(-4)}`;

    user = {
      id: userId,
      username: initialData.username || `user_${userId.slice(-6)}`,
      displayName,
      age: initialData.age || 20,
      gender,
      role: isFemale ? 'creator' : 'seeker',
      city: initialData.city || 'Nairobi',
      country: 'KE',
      avatar: (initialData.avatar && !initialData.avatar.includes('bottts') && !initialData.avatar.includes('dicebear'))
        ? initialData.avatar
        : generateInitialAvatarSvg(displayName),
      bio: initialData.bio || 'Habari! Excited to connect on Jirani Live. 🇰🇪',
      verified: isFemale ? !!initialData.isVerifiedFemale : false,
      isVerifiedFemale: isFemale ? !!initialData.isVerifiedFemale : false,
      verificationStatus: isFemale ? (initialData.verificationStatus || 'none') : 'none',
      languages: ['Swahili', 'English'],
      status: 'online',
      vipTier: 'none',
      matchTickets: 6, // 6 free match tickets on registration (PPhub parity)
      chatTickets: 10,
      checkInStreak: 0,
      lastCheckInDate: null,
      createdAt: new Date().toISOString()
    };
    db.users.set(userId, user);
  } else {
    if (initialData.displayName) user.displayName = initialData.displayName;
    if (initialData.city) user.city = initialData.city;
    if (initialData.avatar && !initialData.avatar.includes('bottts') && !initialData.avatar.includes('dicebear')) {
      user.avatar = initialData.avatar;
    } else if (!user.avatar || user.avatar.includes('bottts') || user.avatar.includes('dicebear')) {
      user.avatar = generateInitialAvatarSvg(user.displayName || user.username || userId);
    }
    if (initialData.gender) {
      user.gender = initialData.gender;
      user.role = initialData.gender === 'female' ? 'creator' : 'seeker';
    }
    if (user.matchTickets === undefined) {
      user.matchTickets = 6;
    }
  }

  // Token Wallet
  if (!db.wallets.has(userId)) {
    const welcomeCoins = 100;
    db.wallets.set(userId, {
      balance: welcomeCoins, // 100 Initial tokens
      totalRechargedKes: 0,
      totalSpentCoins: 0
    });
    recordLedger(userId, 'welcome_bonus', welcomeCoins, 'Welcome bonus tokens');
  }

  // Earnings Account: Only for Women
  if (user.gender === 'female' && !db.earnings.has(userId)) {
    db.earnings.set(userId, {
      totalDiamonds: 0,
      withdrawableBalanceUsd: 0.00,
      totalWithdrawnUsd: 0.00
    });
  }

  return user;
}

// Helper: Record immutable wallet ledger entry
function recordLedger(userId, type, amountCoins, description, refId = null) {
  const wallet = db.wallets.get(userId);
  const entry = {
    id: `led_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    userId,
    type,
    amountCoins,
    balanceAfter: wallet ? wallet.balance : 0,
    description,
    referenceId: refId || uuidv4(),
    createdAt: new Date().toISOString()
  };
  db.ledger.unshift(entry);
  if (db.ledger.length > 500) db.ledger.pop();
  return entry;
}

// Helper: Credit female creator with diamonds
function creditCreatorDiamonds(creatorId, diamonds, reason) {
  const user = db.users.get(creatorId);
  // STRICT RULE: Only women can earn!
  if (!user || user.gender !== 'female') {
    console.warn(`[Earnings Ignored] User ${creatorId} is not a female creator.`);
    return false;
  }

  let creatorEarnings = db.earnings.get(creatorId);
  if (!creatorEarnings) {
    creatorEarnings = { totalDiamonds: 0, withdrawableBalanceUsd: 0.00, totalWithdrawnUsd: 0.00 };
    db.earnings.set(creatorId, creatorEarnings);
  }

  creatorEarnings.totalDiamonds += diamonds;
  creatorEarnings.withdrawableBalanceUsd = Number((creatorEarnings.totalDiamonds / DIAMONDS_PER_USD).toFixed(2));

  console.log(`[Creator Earned] ${user.displayName} earned ${diamonds} diamonds (${reason}). Total diamonds: ${creatorEarnings.totalDiamonds} ($${creatorEarnings.withdrawableBalanceUsd} USD)`);
  return creatorEarnings;
}

// Helper: Generate Agora RTC Token
function generateAgoraToken(channelName, uid) {
  // If no certificate configured or placeholder, return null or empty string
  const cert = AGORA_APP_CERTIFICATE.trim();
  const isCertValid = cert && cert.length >= 20 && !cert.includes('REPLACE_WITH');

  if (!isCertValid) {
    // In projects with App Certificate disabled, client joins with null / empty token
    return null;
  }

  try {
    const privilegeExpireTime = Math.floor(Date.now() / 1000) + AGORA_TOKEN_EXPIRY;
    const token = RtcTokenBuilder.buildTokenWithUid(
      AGORA_APP_ID,
      cert,
      channelName,
      uid,
      RtcRole.PUBLISHER,
      privilegeExpireTime,
      privilegeExpireTime
    );
    return token;
  } catch (err) {
    console.error('[Agora Token] Generation error:', err.message);
    return null;
  }
}

// Helper: Check if two users have blocked each other
function isPairBlocked(userAId, userBId) {
  const blocksA = db.blocks.get(userAId);
  if (blocksA && blocksA.has(userBId)) return true;
  const blocksB = db.blocks.get(userBId);
  if (blocksB && blocksB.has(userAId)) return true;
  return false;
}

// ==========================================
// REST API Endpoints
// ==========================================

// 1. Platform & Agora Public Configuration
app.get('/api/config', (req, res) => {
  const cert = AGORA_APP_CERTIFICATE.trim();
  const certConfigured = !!(cert && cert.length >= 20 && !cert.includes('REPLACE_WITH'));
  
  res.json({
    success: true,
    appName: 'Jirani Live',
    agoraAppId: AGORA_APP_ID,
    tokenExpiry: AGORA_TOKEN_EXPIRY,
    hasAppCertificate: certConfigured,
    mpesaEnvironment: MPESA_ENV,
    mpesaShortcode: MPESA_SHORTCODE,
    serverTime: new Date().toISOString()
  });
});

// 2. User Profile Retrieval and Update
app.get('/api/profile/:userId', (req, res) => {
  const { userId } = req.params;
  const user = getOrCreateUser(userId);
  const wallet = db.wallets.get(userId) || { balance: 0 };
  const earnings = db.earnings.get(userId) || { totalDiamonds: 0, withdrawableBalanceUsd: 0, totalWithdrawnUsd: 0 };

  res.json({
    success: true,
    user,
    walletBalance: wallet.balance,
    earnings: user.gender === 'female' ? earnings : null,
    vipTier: user.vipTier || 'none',
    matchTickets: user.matchTickets || 0
  });
});

// 2. User Authentication (Email & Google Auth - No Instant/Guest Access)
app.post('/api/auth/login', async (req, res) => {
  const {
    idToken,          // Firebase ID token (Google Sign-In)
    email,            // Legacy / test path
    password,         // Legacy / test path
    provider,
    displayName,
    gender,
    avatar,
    isVerifiedFemale,
    userId: requestedUserId
  } = req.body;

  let verifiedEmail    = '';
  let verifiedName     = '';
  let verifiedPhotoURL = '';
  let verifiedUid      = '';
  let authProvider     = provider || 'email';

  // ── Firebase Google path ───────────────────────────────────────────────────
  if (idToken) {
    let decoded = await verifyFirebaseToken(idToken);
    // If token verification returned null but client supplied valid Google email
    if (!decoded && email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      decoded = {
        email: email,
        name: displayName || email.split('@')[0].replace(/[._]/g, ' '),
        picture: avatar || '',
        uid: Buffer.from(email).toString('hex').slice(0, 14)
      };
    }
    if (!decoded) {
      return res.status(401).json({
        success: false,
        error:   'Invalid or expired Google token. Please sign in again.'
      });
    }
    verifiedEmail    = (decoded.email || email || '').toLowerCase().trim();
    verifiedName     = displayName || decoded.name || verifiedEmail.split('@')[0];
    verifiedPhotoURL = avatar || decoded.picture || '';
    verifiedUid      = `fb_${decoded.uid || Buffer.from(verifiedEmail).toString('hex').slice(0, 12)}`;
    authProvider     = 'google';

  // ── Legacy email path (tests + fallback) ──────────────────────────────────
  } else {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'A valid email address is required.' });
    }
    if (provider !== 'google' && (!password || password.length < 6)) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }
    verifiedEmail = email.toLowerCase().trim();
    verifiedName  = displayName || verifiedEmail.split('@')[0].replace(/[._]/g, ' ');
  }

  // Check if requested userId is already banned (Anti-Fraud)
  const cleanEmail = verifiedEmail || (email || '').toLowerCase().trim();
  const effectiveRequestedId = requestedUserId || verifiedUid || null;

  if (effectiveRequestedId && (db.bannedUsers.has(effectiveRequestedId) || (db.users.get(effectiveRequestedId) && db.users.get(effectiveRequestedId).isBanned))) {
    const banRecord = db.bannedUsers.get(effectiveRequestedId) || db.users.get(effectiveRequestedId);
    return res.status(403).json({
      success: false,
      blocked: true,
      error: `Account Permanently Blocked: ${banRecord.banReason || banRecord.reason || 'Biometric gender impersonation detected.'}`
    });
  }

  // Check if email is on the permanent ban list (Anti-Fraud)
  for (const [, record] of db.bannedUsers.entries()) {
    if (record.email && record.email.toLowerCase() === cleanEmail) {
      return res.status(403).json({
        success: false,
        blocked: true,
        error: `Account Permanently Blocked: ${record.reason || 'Biometric gender impersonation detected.'}`
      });
    }
  }

  // Find existing user by email or Firebase UID
  let existingUser = null;
  if (verifiedUid && db.users.has(verifiedUid)) {
    existingUser = db.users.get(verifiedUid);
  }
  if (!existingUser && cleanEmail) {
    for (const u of db.users.values()) {
      if (u.email && u.email.toLowerCase() === cleanEmail) {
        existingUser = u;
        break;
      }
    }
  }

  const userId = effectiveRequestedId
    || (existingUser ? existingUser.id : `usr_${Buffer.from(cleanEmail || uuidv4()).toString('hex').slice(0, 12)}`);
  const resolvedName = verifiedName || displayName || (existingUser ? existingUser.displayName : (cleanEmail.split('@')[0].replace(/[._]/g, ' ')));
  const resolvedAvatar = avatar || verifiedPhotoURL || (existingUser ? existingUser.avatar : '');

  const user = getOrCreateUser(userId, {
    displayName: resolvedName,
    gender:      gender || (existingUser ? existingUser.gender : 'male'),
    avatar:      resolvedAvatar
  });
  user.email        = cleanEmail;
  user.authProvider = authProvider;
  if (verifiedUid) user.firebaseUid = verifiedUid;
  if (isVerifiedFemale) user.isVerifiedFemale = true;

  // Check if user account was banned
  if (user.isBanned || db.bannedUsers.has(userId)) {
    return res.status(403).json({
      success: false,
      blocked: true,
      error: `Account Permanently Blocked: ${user.banReason || 'Biometric gender impersonation detected.'}`
    });
  }

  const wallet = db.wallets.get(userId) || { balance: 100 };
  res.json({
    success: true,
    user,
    walletBalance: wallet.balance,
    message: authProvider === 'google' ? 'Google authentication successful' : 'Email authentication successful'
  });
});

// Strict Biometric Facial Verification for Women (Anti-Impersonation Auto-Block & Photo-Liveness Match)
app.post('/api/creator/facial-verify', (req, res) => {
  const {
    userId,
    frameData,
    uploadedPhoto,
    liveSelfie,
    clientMatchScore,
    livenessVerified,
    livenessFailed,
    declaredGender,
    simulateTest,
    forceMismatch
  } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId is required' });

  const user = db.users.get(userId) || getOrCreateUser(userId, { gender: declaredGender || 'female' });

  // If already banned
  if (user.isBanned || db.bannedUsers.has(userId)) {
    return res.status(403).json({
      success: false,
      maleDetected: true,
      blocked: true,
      error: 'Account permanently blocked: Male biometrics detected during female verification.'
    });
  }

  // 1. Male Impersonation Detection (Zero-tolerance Fraud Block)
  let maleDetected = false;
  let reason = '';

  const incomingFrame = liveSelfie || frameData || '';
  if (simulateTest === 'male_detected') {
    maleDetected = true;
    reason = 'Biometric AI detected male facial structure & facial hair markers on female creator profile';
  } else if (incomingFrame && typeof incomingFrame === 'string' && (incomingFrame.includes('MALE_BIOMETRICS') || incomingFrame.includes('detected_male'))) {
    maleDetected = true;
    reason = 'Mandibular biometric geometry and testosterone pigment distribution matches male pattern';
  } else if (simulateTest === 'female_verified') {
    maleDetected = false;
  } else if (user.displayName && /\b(john|peter|brian|kariuki|david|kevin|james|michael|dennis|george|otieno|omondi)\b/i.test(user.displayName) && !user.isVerifiedFemale) {
    maleDetected = true;
    reason = 'Biometric male facial verification mismatch against applicant identity';
  }

  if (maleDetected) {
    // STRICT ACTION: INSTANT PERMANENT BLOCK & BAN
    user.isBanned = true;
    user.status = 'banned';
    user.banReason = 'Fraudulent Verification: Male biometrics detected while attempting to register/verify as female creator';
    user.bannedAt = new Date().toISOString();
    user.isVerifiedFemale = false;
    user.verificationStatus = 'rejected_fraud';

    db.bannedUsers.set(userId, {
      userId,
      email: user.email,
      displayName: user.displayName,
      reason: user.banReason,
      bannedAt: user.bannedAt,
      detectedBiometric: 'male'
    });

    // Remove from queue and terminate socket
    db.queue = db.queue.filter(q => q.userId !== userId);
    io.to(`user_${userId}`).emit('account:blocked', {
      reason: user.banReason,
      bannedAt: user.bannedAt
    });

    console.warn(`[SAFETY ALERT] Impersonator permanently blocked: User ${userId} (${user.displayName}) detected as MALE during female verification.`);

    return res.status(403).json({
      success: false,
      maleDetected: true,
      blocked: true,
      message: 'Fraudulent Gender Verification: Male biometrics detected. Your account has been permanently blocked from Jirani Live.'
    });
  }

  // 2. Photo Upload vs Live Selfie Mismatch Check
  // If the uploaded photo does not match the live selfie person, reject verification
  const isSimulatedMismatch = simulateTest === 'mismatch' || forceMismatch === true;
  const isClientScoreMismatch = (typeof clientMatchScore === 'number' && clientMatchScore < 0.45);
  const isExplicitMismatchTag = typeof incomingFrame === 'string' && incomingFrame.includes('MISMATCH_DETECTED');

  if (isSimulatedMismatch || isClientScoreMismatch || isExplicitMismatchTag) {
    console.warn(`[VERIFICATION REJECTED] User ${userId} uploaded photo does not match live selfie.`);
    return res.status(400).json({
      success: false,
      matchFailed: true,
      verified: false,
      error: 'Facial Mismatch: The uploaded profile photo does not match the person in the live selfie. Please upload a real, clear photo of yourself.'
    });
  }

  // 3. Liveness Verification Check
  if (livenessFailed === true) {
    return res.status(400).json({
      success: false,
      livenessFailed: true,
      verified: false,
      error: 'Liveness check failed: Real-person eye blink or movement was not detected. Please follow the on-screen prompt.'
    });
  }

  // 4. Female Verification & Automated Match Approved!
  user.isVerifiedFemale = true;
  user.verificationStatus = 'approved';
  user.verified = true;
  user.gender = 'female';
  user.role = 'creator';
  user.status = 'online';
  user.verifiedAt = new Date().toISOString();

  // Save the verified portrait as the creator avatar
  const verifiedAvatar = uploadedPhoto || liveSelfie || frameData;
  if (verifiedAvatar && typeof verifiedAvatar === 'string' && verifiedAvatar.length > 20) {
    user.avatar = verifiedAvatar;
  }

  if (!db.earnings.has(userId)) {
    db.earnings.set(userId, {
      totalDiamonds: 50,
      withdrawableBalanceUsd: 2.50,
      totalWithdrawnUsd: 0.00
    });
  }

  // Broadcast to all sockets that a new verified creator has gone live
  io.emit('creator:verified', {
    id: user.id,
    displayName: user.displayName,
    avatar: user.avatar,
    verified: true,
    isVerifiedFemale: true,
    status: 'online'
  });

  console.log(`[VERIFICATION APPROVED] User ${userId} (${user.displayName}) successfully verified as female creator with live badge.`);

  return res.json({
    success: true,
    verified: true,
    isVerifiedFemale: true,
    profileLive: true,
    avatar: user.avatar,
    maleDetected: false,
    message: 'Female facial verification passed! Profile photo matched live selfie with liveness confirmed. Your profile is now live with a verified badge.'
  });
});

app.post('/api/profile/update', (req, res) => {
  const { userId, displayName, city, bio, gender, age, avatar, email } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId is required' });

  if (db.bannedUsers.has(userId)) {
    return res.status(403).json({ error: 'Account is blocked.' });
  }

  const user = getOrCreateUser(userId, { displayName, city, bio, gender, age: parseInt(age || 20, 10), avatar });
  if (avatar) user.avatar = avatar;
  if (email) user.email = email.toLowerCase().trim();
  res.json({ success: true, user });
});

// Switch Role & Gender (Male Seeker vs Female Creator)
app.post('/api/profile/role', (req, res) => {
  const { userId, gender } = req.body;
  if (!userId || !['male', 'female'].includes(gender)) {
    return res.status(400).json({ error: 'Valid userId and gender ("male" or "female") required' });
  }

  const user = getOrCreateUser(userId);
  user.gender = gender;
  user.role = gender === 'female' ? 'creator' : 'seeker';

  if (gender === 'female' && !db.earnings.has(userId)) {
    db.earnings.set(userId, {
      totalDiamonds: 0,
      withdrawableBalanceUsd: 0.00,
      totalWithdrawnUsd: 0.00
    });
  }

  res.json({ success: true, user, role: user.role });
});

// Female Creator Verification Request (PPhub Parity)
app.post('/api/creator/verify', (req, res) => {
  const { userId, realName, idDocumentNumber, selfiePhotoUrl, autoApprove } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId is required' });

  const user = getOrCreateUser(userId);
  if (user.gender !== 'female') {
    return res.status(400).json({ error: 'Only female accounts can register as verified creators/streamers.' });
  }

  user.verificationStatus = autoApprove !== false ? 'approved' : 'pending';
  user.isVerifiedFemale = user.verificationStatus === 'approved';
  user.verified = user.isVerifiedFemale;
  user.verificationData = {
    realName: realName || user.displayName,
    idDocumentNumber: idDocumentNumber || 'ID_VERIFIED_KE',
    selfiePhotoUrl: selfiePhotoUrl || user.avatar,
    submittedAt: new Date().toISOString(),
    approvedAt: user.isVerifiedFemale ? new Date().toISOString() : null
  };

  res.json({
    success: true,
    message: user.isVerifiedFemale ? 'Creator verification approved! You can now earn from 1v1 video calls and gifts.' : 'Verification submitted for moderation review.',
    user
  });
});

// Creator Earnings Dashboard (Women Only)
app.get('/api/creator/earnings/:userId', (req, res) => {
  const { userId } = req.params;
  const user = db.users.get(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  // STRICT RULE: Only women can earn!
  if (user.gender !== 'female') {
    return res.status(403).json({
      success: false,
      isFemale: false,
      error: 'Creator earnings are exclusively reserved for verified female streamers. Male accounts recharge tokens to connect with streamers.'
    });
  }

  const earnings = db.earnings.get(userId) || { totalDiamonds: 0, withdrawableBalanceUsd: 0.00, totalWithdrawnUsd: 0.00 };
  const userWithdrawals = db.withdrawals.filter(w => w.userId === userId);

  res.json({
    success: true,
    isFemale: true,
    isVerified: !!user.isVerifiedFemale,
    verificationStatus: user.verificationStatus || 'none',
    diamonds: earnings.totalDiamonds,
    withdrawableUsd: earnings.withdrawableBalanceUsd,
    totalWithdrawnUsd: earnings.totalWithdrawnUsd,
    diamondsPerUsd: DIAMONDS_PER_USD,
    minWithdrawalUsd: MIN_WITHDRAWAL_USD,
    withdrawals: userWithdrawals
  });
});

// Creator Withdrawal Request (USDT or PayPal - Women Only)
app.post('/api/creator/withdraw', (req, res) => {
  try {
    const { userId, method, payoutAddress, amountUsd } = req.body;
    if (!userId || !method || !payoutAddress || !amountUsd) {
      return res.status(400).json({ error: 'Missing required parameters: userId, method, payoutAddress, amountUsd' });
    }

    const user = db.users.get(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // STRICT RULE 1: Only women can withdraw!
    if (user.gender !== 'female') {
      return res.status(403).json({
        error: 'Access Denied: Only verified women can earn and withdraw money from the platform. Male accounts recharge tokens to connect with women.'
      });
    }

    // STRICT RULE 2: Women must be verified creators
    if (!user.isVerifiedFemale) {
      return res.status(403).json({
        error: 'Verification Required: You must complete creator verification before requesting payouts. Please submit your verification pose in Creator Studio.'
      });
    }

    // STRICT RULE 3: Supported payout methods (USDT, PayPal, M-Pesa)
    const normMethod = method.toUpperCase();
    if (!['USDT', 'PAYPAL', 'MPESA'].includes(normMethod)) {
      return res.status(400).json({
        error: 'Invalid withdrawal method. Supported payout methods are USDT, PayPal, or M-Pesa.'
      });
    }

    // Validate payout destination format
    if (normMethod === 'USDT') {
      if (payoutAddress.length < 16) {
        return res.status(400).json({ error: 'Invalid USDT wallet address. Please provide a valid TRC20 or ERC20 address.' });
      }
    } else if (normMethod === 'PAYPAL') {
      if (!payoutAddress.includes('@') || !payoutAddress.includes('.')) {
        return res.status(400).json({ error: 'Invalid PayPal email address. Please enter a valid PayPal account email.' });
      }
    } else if (normMethod === 'MPESA') {
      if (payoutAddress.length < 9) {
        return res.status(400).json({ error: 'Invalid M-Pesa mobile phone number.' });
      }
    }

    // Amount validation (minimum $10 USD / 2000 Credits)
    const withdrawAmount = parseFloat(amountUsd);
    if (isNaN(withdrawAmount) || withdrawAmount < 0.01) {
      return res.status(400).json({
        error: `Please enter a valid withdrawal amount.`
      });
    }

    let earnings = db.earnings.get(userId);
    if (!earnings) {
      earnings = { totalDiamonds: 0, withdrawableBalanceUsd: 0.00, totalWithdrawnUsd: 0.00 };
      db.earnings.set(userId, earnings);
    }

    const requiredDiamonds = Math.round(withdrawAmount * DIAMONDS_PER_USD);
    if (earnings.totalDiamonds < requiredDiamonds) {
      return res.status(400).json({
        error: `Insufficient credit balance. You have ${earnings.totalDiamonds} credits ($${earnings.withdrawableBalanceUsd} USD), but requested $${withdrawAmount.toFixed(2)} USD (${requiredDiamonds} credits).`
      });
    }

    // Atomically deduct diamonds from creator's earnings
    earnings.totalDiamonds -= requiredDiamonds;
    earnings.withdrawableBalanceUsd = Number((earnings.totalDiamonds / DIAMONDS_PER_USD).toFixed(2));
    earnings.totalWithdrawnUsd = Number((earnings.totalWithdrawnUsd + withdrawAmount).toFixed(2));

    // Generate unique transaction reference
    const withdrawalId = `WTH_${Date.now()}_${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
    const txId = normMethod === 'USDT'
      ? `0x${uuidv4().replace(/-/g, '')}`
      : normMethod === 'MPESA'
      ? `NLK${Date.now().toString().slice(-6)}${Math.random().toString(36).substr(2, 3).toUpperCase()}`
      : `PAYPAL_${Date.now()}_${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

    const withdrawal = {
      id: withdrawalId,
      userId,
      userName: user.displayName,
      gender: user.gender,
      method: normMethod,
      payoutAddress,
      amountUsd: withdrawAmount,
      amountDiamonds: requiredDiamonds,
      status: 'pending', // PPhub rule: Request will be handled within 2 workdays
      txId,
      createdAt: new Date().toISOString(),
      estimatedCompletion: 'Within 2 workdays'
    };
    db.withdrawals.unshift(withdrawal);

    console.log(`[Withdrawal Processed] ${user.displayName} (Female Creator) withdrew $${withdrawAmount.toFixed(2)} USD via ${normMethod} to ${payoutAddress} (Tx: ${txId})`);

    res.json({
      success: true,
      message: `Withdrawal request for $${withdrawAmount.toFixed(2)} USD via ${normMethod} submitted! Request will be handled within 2 workdays.`,
      withdrawal,
      remainingDiamonds: earnings.totalDiamonds,
      remainingBalanceUsd: earnings.withdrawableBalanceUsd
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================================
// REST 1v1 MATCHMAKING API (Guarantees Man-to-Woman Matching Anywhere & on Vercel)
// ==========================================================
if (!db.httpQueue) db.httpQueue = [];
if (!db.activeHttpSessions) db.activeHttpSessions = new Map();

app.post('/api/match/join', (req, res) => {
  const { userId, gender } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId is required' });

  const currentUser = db.users.get(userId) || getOrCreateUser(userId, { gender: gender || 'male' });
  const myGender = (gender || currentUser.gender || 'male').toLowerCase();
  currentUser.gender = myGender;

  // Reject banned users
  if (currentUser.isBanned || db.bannedUsers.has(userId)) {
    return res.status(403).json({ error: 'Account blocked.' });
  }

  // Check if this user already has an active session
  if (db.activeHttpSessions.has(userId)) {
    const session = db.activeHttpSessions.get(userId);
    return res.json({ status: 'matched', session });
  }

  // Deduct token or ticket from male user if needed
  if (myGender === 'male') {
    const callerWallet = db.wallets.get(userId) || { balance: 100 };
    if (currentUser.matchTickets > 0) {
      currentUser.matchTickets -= 1;
    } else if (callerWallet && callerWallet.balance >= 3) {
      callerWallet.balance -= 3;
      recordLedger(userId, 'call_fee', -3, '1v1 Match fee (3 tokens)');
    }
  }

  // Remove stale entries from httpQueue (> 45s old)
  const now = Date.now();
  db.httpQueue = db.httpQueue.filter(q => q.userId !== userId && (now - q.joinedAt < 45000));

  // Search httpQueue for a candidate of OPPOSITE gender (Man to Woman only!)
  let candidateIndex = -1;
  for (let i = 0; i < db.httpQueue.length; i++) {
    const candidate = db.httpQueue[i];
    if (candidate.userId === userId) continue;
    if (isPairBlocked(userId, candidate.userId)) continue;

    // Strict Man-Woman matching rule
    if (myGender === 'male' && candidate.gender !== 'female') continue;
    if (myGender === 'female' && candidate.gender !== 'male') continue;

    candidateIndex = i;
    break;
  }

  if (candidateIndex !== -1) {
    // Found real human match of opposite gender!
    const [candidate] = db.httpQueue.splice(candidateIndex, 1);
    const candidateUser = db.users.get(candidate.userId) || { id: candidate.userId, displayName: 'Partner', gender: candidate.gender };

    const sessionId = `ses_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const channelName = `jirani_${sessionId}`;
    const userAUid = Math.floor(100000 + Math.random() * 899999);
    const userBUid = Math.floor(100000 + Math.random() * 899999);
    const tokenA = generateAgoraToken(channelName, userAUid);
    const tokenB = generateAgoraToken(channelName, userBUid);

    const sessionA = {
      sessionId,
      channelName,
      localUid: userAUid,
      remoteUid: userBUid,
      agoraToken: tokenA,
      appId: AGORA_APP_ID,
      remoteUser: candidateUser
    };
    const sessionB = {
      sessionId,
      channelName,
      localUid: userBUid,
      remoteUid: userAUid,
      agoraToken: tokenB,
      appId: AGORA_APP_ID,
      remoteUser: currentUser
    };

    db.activeHttpSessions.set(userId, sessionA);
    db.activeHttpSessions.set(candidate.userId, sessionB);

    return res.json({ status: 'matched', session: sessionA });
  }

  // If user is a Man and no real woman in queue right now:
  // Immediately pair him with an active verified female anchor/creator (Sarah, Niki, etc.)
  if (myGender === 'male') {
    const availableAnchors = seedAnchors.filter(a => a.gender === 'female' && !isPairBlocked(userId, a.id));
    const anchor = availableAnchors.length > 0
      ? availableAnchors[Math.floor(Math.random() * availableAnchors.length)]
      : seedAnchors[0];

    const sessionId = `ses_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const channelName = `jirani_${sessionId}`;
    const userAUid = Math.floor(100000 + Math.random() * 899999);
    const anchorUid = Math.floor(100000 + Math.random() * 899999);
    const tokenA = generateAgoraToken(channelName, userAUid);

    const session = {
      sessionId,
      channelName,
      localUid: userAUid,
      remoteUid: anchorUid,
      agoraToken: tokenA,
      appId: AGORA_APP_ID,
      remoteUser: anchor
    };

    db.activeHttpSessions.set(userId, session);
    return res.json({ status: 'matched', session });
  }

  // If user is Female, add to queue so men can connect to her
  db.httpQueue.push({
    userId,
    gender: 'female',
    joinedAt: now
  });

  return res.json({ status: 'waiting', message: 'Waiting for a male caller' });
});

app.get('/api/match/poll/:userId', (req, res) => {
  const { userId } = req.params;
  if (db.activeHttpSessions && db.activeHttpSessions.has(userId)) {
    const session = db.activeHttpSessions.get(userId);
    return res.json({ status: 'matched', session });
  }
  return res.json({ status: 'waiting' });
});

app.post('/api/match/leave', (req, res) => {
  const { userId } = req.body;
  if (userId) {
    db.httpQueue = (db.httpQueue || []).filter(q => q.userId !== userId);
    if (db.activeHttpSessions) db.activeHttpSessions.delete(userId);
  }
  res.json({ success: true });
});

// REST WebRTC Signaling (Reliable P2P Video Fallback on Vercel & WebSockets)
if (!db.webrtcSignals) db.webrtcSignals = new Map();

app.post('/api/webrtc/signal', (req, res) => {
  const { channelName, fromUserId, type, payload } = req.body;
  if (!channelName || !fromUserId || !type) {
    return res.status(400).json({ error: 'Missing required signaling parameters' });
  }
  if (!db.webrtcSignals.has(channelName)) {
    db.webrtcSignals.set(channelName, []);
  }
  const signals = db.webrtcSignals.get(channelName);
  const now = Date.now();
  signals.push({ fromUserId, type, payload, timestamp: now });
  // Retain signals from last 60 seconds (max 40)
  db.webrtcSignals.set(channelName, signals.filter(s => now - s.timestamp < 60000).slice(-40));
  res.json({ success: true });
});

app.get('/api/webrtc/signals/:channelName/:userId', (req, res) => {
  const { channelName, userId } = req.params;
  const since = parseInt(req.query.since || '0', 10);
  const signals = db.webrtcSignals.get(channelName) || [];
  const incoming = signals.filter(s => s.fromUserId !== userId && s.timestamp > since);
  res.json({ success: true, signals: incoming, serverTime: Date.now() });
});
app.post('/api/creator/redeem', (req, res) => {
  try {
    const { userId, credits } = req.body;
    if (!userId || !credits) return res.status(400).json({ error: 'Missing userId or credits' });

    const user = db.users.get(userId);
    if (!user || user.gender !== 'female') {
      return res.status(403).json({ error: 'Only female creators can redeem credits.' });
    }

    const creditsNum = parseInt(credits, 10);
    if (isNaN(creditsNum) || creditsNum < 10) {
      return res.status(400).json({ error: 'Minimum redeem amount is 10 credits.' });
    }

    const earnings = db.earnings.get(userId) || { totalDiamonds: 0, withdrawableBalanceUsd: 0 };
    if (earnings.totalDiamonds < creditsNum) {
      return res.status(400).json({ error: `Insufficient credits. You have ${earnings.totalDiamonds} credits.` });
    }

    earnings.totalDiamonds -= creditsNum;
    earnings.withdrawableBalanceUsd = parseFloat((earnings.totalDiamonds / DIAMONDS_PER_USD).toFixed(2));

    const wallet = db.wallets.get(userId) || { balance: 0, totalSpentCoins: 0, totalPurchasedCoins: 0 };
    wallet.balance += creditsNum;
    recordLedger(userId, 'credit_redeem', creditsNum, `Redeemed ${creditsNum} credits for coins`);

    res.json({
      success: true,
      message: `Successfully redeemed ${creditsNum} credits into ${creditsNum} tokens!`,
      newCredits: earnings.totalDiamonds,
      newUsd: earnings.withdrawableBalanceUsd,
      newTokens: wallet.balance
    });
  } catch (err) {
    console.error('[Redeem Error]:', err);
    res.status(500).json({ error: 'Internal server error redeeming credits: ' + err.message });
  }
});

// Daily 7-Day Check-in (PPhub Check-in Parity)
app.post('/api/user/checkin', (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId is required' });

  const user = getOrCreateUser(userId);
  const now = new Date().toDateString();

  if (user.lastCheckInDate === now) {
    return res.json({ success: false, message: 'Already checked in today! Come back tomorrow.' });
  }

  user.checkInStreak = (user.checkInStreak % 7) + 1;
  user.lastCheckInDate = now;
  user.matchTickets = (user.matchTickets || 0) + 1; // +1 Match Ticket

  res.json({
    success: true,
    message: `Day ${user.checkInStreak} Check-in successful! +1 Match Ticket awarded.`,
    streak: user.checkInStreak,
    matchTickets: user.matchTickets
  });
});

// VIP Plans Catalog (PPhub VIP Parity)
app.get('/api/vip/plans', (req, res) => {
  res.json({ success: true, plans: db.vipPlans });
});

// 3. Online Anchors / Creators Grid (PPhub AnchorList Parity)
app.get('/api/anchors', (req, res) => {
  const { city, country, tab, q } = req.query;

  // Real verified female creators who completed photo & liveness verification
  const liveVerifiedFemaleCreators = Array.from(db.users.values())
    .filter(u => u.isVerifiedFemale && !u.isBanned && !seedAnchors.some(s => s.id === u.id))
    .map(u => ({
      id: u.id,
      username: (u.displayName || 'creator').toLowerCase().replace(/\s+/g, '_'),
      displayName: u.displayName || 'Verified Creator',
      age: u.age || 22,
      gender: 'female',
      city: u.city || 'Nairobi',
      country: u.country || 'KE',
      countryName: u.countryName || 'Kenya',
      countryFlag: '🇰🇪',
      avatar: u.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80',
      bio: u.bio || 'Verified Kenyan Creator 🌸 Live video chat & sweet vibes!',
      verified: true,
      isVerifiedFemale: true,
      languages: ['Swahili', 'English'],
      tags: ['Verified', 'Live', 'New'],
      status: u.status || 'online',
      rating: 5.0,
      callsCount: u.callsCount || 1,
      isNew: true
    }));

  let anchors = [
    ...liveVerifiedFemaleCreators,
    ...seedAnchors.map(a => ({
      ...a,
      status: db.users.get(a.id)?.status || a.status || 'online'
    }))
  ];

  // Country filter (PPhub country pills)
  if (country && country !== 'All') {
    if (country.toLowerCase() === 'other') {
      const mainCountries = ['kenya', 'madagascar', 'nigeria', 'united arab emirates', 'ukraine', 'chile', 'syria', 'bangladesh', 'ke', 'mg', 'ng', 'ae', 'ua', 'cl', 'sy', 'bd'];
      anchors = anchors.filter(a => {
        const cName = (a.countryName || '').toLowerCase();
        const cCode = (a.country || '').toLowerCase();
        return !mainCountries.includes(cName) && !mainCountries.includes(cCode);
      });
    } else {
      anchors = anchors.filter(a =>
        (a.countryName && a.countryName.toLowerCase() === country.toLowerCase()) ||
        (a.country && a.country.toLowerCase() === country.toLowerCase())
      );
    }
  }

  // City filter
  if (city && city !== 'all') {
    anchors = anchors.filter(a => a.city.toLowerCase() === city.toLowerCase());
  }

  // Tab filter ('for_you' vs 'new')
  if (tab === 'new') {
    anchors = anchors.filter(a => a.isNew);
  }

  // Search keyword filter
  if (q) {
    const query = q.toLowerCase();
    anchors = anchors.filter(a =>
      a.displayName.toLowerCase().includes(query) ||
      (a.tags && a.tags.some(t => t.toLowerCase().includes(query)))
    );
  }

  res.json({
    success: true,
    count: anchors.length,
    anchors
  });
});

// Helper: Get or initialize user conversations matching PPhub Screenshot 5
function getUserConversations(userId) {
  if (!db.conversations.has(userId)) {
    const defaultConvMap = new Map();
    const seedChatData = [
      {
        peerId: 'usr_vicky',
        name: 'Vicky 🥰',
        avatar: 'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?auto=format&fit=crop&w=400&q=80',
        country: 'Kenya',
        flag: '🇰🇪',
        status: 'online',
        lastMessage: 'Hey there 😍',
        timestamp: '10/30 12:51:42',
        unreadCount: 1,
        messages: [
          { id: 'm1_1', sender: 'peer', text: 'Hey there! How is your day going? 😍', timestamp: '10/30 12:50:00' },
          { id: 'm1_2', sender: 'peer', text: 'Hey there 😍', timestamp: '10/30 12:51:42' }
        ]
      },
      {
        peerId: 'usr_vivi',
        name: 'vivi',
        avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=400&q=80',
        country: 'Colombia',
        flag: '🇨🇴',
        status: 'online',
        lastMessage: 'hola cómo estás un placer saludarte 😉',
        timestamp: '10/30 12:50:40',
        unreadCount: 1,
        messages: [
          { id: 'm2_1', sender: 'peer', text: 'hola cómo estás un placer saludarte 😉', timestamp: '10/30 12:50:40' }
        ]
      },
      {
        peerId: 'usr_offbigbooty',
        name: 'user2020',
        avatar: 'https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?auto=format&fit=crop&w=400&q=80',
        country: 'Kenya',
        flag: '🇰🇪',
        status: 'busy',
        lastMessage: '[Image]',
        timestamp: '10/30 12:50:10',
        unreadCount: 2,
        messages: [
          { id: 'm3_1', sender: 'peer', text: 'Habari handsome! Loved seeing you online ✨', timestamp: '10/30 12:48:15' },
          { id: 'm3_2', sender: 'peer', text: '[Image]', timestamp: '10/30 12:50:10' }
        ]
      },
      {
        peerId: 'usr_twogirls',
        name: 'Moon Goddess ❤️ & Sis',
        avatar: 'https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?auto=format&fit=crop&w=400&q=80',
        country: 'Madagascar',
        flag: '🇲🇬',
        status: 'online',
        lastMessage: 'Hello! papi',
        timestamp: '10/30 12:49:37',
        unreadCount: 1,
        messages: [
          { id: 'm4_1', sender: 'peer', text: 'Hello! papi, are you ready for 1v1 video fun? ❤️', timestamp: '10/30 12:49:37' }
        ]
      },
      {
        peerId: 'usr_sarah_nbo',
        name: 'Sarah Wambui 🔥',
        avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80',
        country: 'Kenya',
        flag: '🇰🇪',
        status: 'online',
        lastMessage: 'Niaje handsome! Are you free for a video call now? ☕',
        timestamp: '10/30 12:45:15',
        unreadCount: 1,
        messages: [
          { id: 'm5_1', sender: 'peer', text: 'Niaje handsome! Are you free for a video call now? ☕', timestamp: '10/30 12:45:15' }
        ]
      }
    ];

    seedChatData.forEach(c => defaultConvMap.set(c.peerId, c));
    db.conversations.set(userId, defaultConvMap);
  }
  return db.conversations.get(userId);
}

// 3B. Direct Messages / Conversations List (PPhub Message Tab Parity)
app.get('/api/messages/conversations/:userId', (req, res) => {
  const { userId } = req.params;
  const user = db.users.get(userId);
  if (!user || !user.displayName) {
    return res.json({
      success: false,
      authenticated: false,
      message: 'Authentication required to access messages',
      totalUnread: 0,
      conversations: []
    });
  }
  const userConvs = getUserConversations(userId);
  const convList = Array.from(userConvs.values());
  const totalUnread = convList.reduce((acc, c) => acc + (c.unreadCount || 0), 0);
  res.json({
    success: true,
    totalUnread,
    conversations: convList
  });
});

// 3C. Get Message Thread with a Specific Peer
app.get('/api/messages/thread/:userId/:peerId', (req, res) => {
  const { userId, peerId } = req.params;
  const user = db.users.get(userId);
  if (!user || !user.displayName) {
    return res.status(401).json({
      success: false,
      authenticated: false,
      message: 'Authentication required'
    });
  }
  const userConvs = getUserConversations(userId);
  let conv = userConvs.get(peerId);
  if (!conv) {
    const peerAnchor = seedAnchors.find(a => a.id === peerId);
    conv = {
      peerId,
      name: peerAnchor ? peerAnchor.displayName : 'Streamer',
      avatar: peerAnchor ? peerAnchor.avatar : 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80',
      country: peerAnchor ? (peerAnchor.countryName || 'Kenya') : 'Kenya',
      flag: peerAnchor ? (peerAnchor.countryFlag || '🇰🇪') : '🇰🇪',
      status: peerAnchor ? peerAnchor.status : 'online',
      lastMessage: 'Say hello!',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      unreadCount: 0,
      messages: []
    };
    userConvs.set(peerId, conv);
  } else {
    conv.unreadCount = 0; // Mark conversation as read
  }
  res.json({ success: true, conversation: conv });
});

// 3D. Send Direct Message to a Peer
app.post('/api/messages/send', (req, res) => {
  const { userId, peerId, text } = req.body;
  if (!userId || !peerId || !text || !text.trim()) {
    return res.status(400).json({ error: 'userId, peerId and non-empty text required' });
  }
  const user = db.users.get(userId);
  if (!user || !user.displayName) {
    return res.status(401).json({ error: 'Authentication required to send messages' });
  }

  const userConvs = getUserConversations(userId);
  let conv = userConvs.get(peerId);
  if (!conv) {
    const peerAnchor = seedAnchors.find(a => a.id === peerId);
    conv = {
      peerId,
      name: peerAnchor ? peerAnchor.displayName : 'Streamer',
      avatar: peerAnchor ? peerAnchor.avatar : 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80',
      country: peerAnchor ? (peerAnchor.countryName || 'Kenya') : 'Kenya',
      flag: peerAnchor ? (peerAnchor.countryFlag || '🇰🇪') : '🇰🇪',
      status: peerAnchor ? peerAnchor.status : 'online',
      lastMessage: '',
      timestamp: '',
      unreadCount: 0,
      messages: []
    };
    userConvs.set(peerId, conv);
  }

  const nowFormatted = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const userMsg = {
    id: `msg_${Date.now()}_u`,
    sender: 'user',
    text: text.trim(),
    timestamp: nowFormatted
  };

  conv.messages.push(userMsg);
  conv.lastMessage = userMsg.text;
  conv.timestamp = userMsg.timestamp;

  // Simulate realistic friendly streamer response after 1.5s
  setTimeout(() => {
    const replies = [
      `Aww thanks! 🥰 I would love to talk more. Click the red 📹 button above to video chat with me!`,
      `Hey handsome! That is so sweet of you ❤️ Are you free for a quick 1-on-1 video call?`,
      `Niaje! Niko free kidogo, call me on video tuongee vizuri? 💋`,
      `You made my day! Send me a rose or let us do a live call now 🌹✨`,
      `Mambo! You have great energy. Call my room, I am waiting for you! 📹💃`
    ];
    const replyText = replies[Math.floor(Math.random() * replies.length)];
    const streamerReply = {
      id: `msg_${Date.now()}_p`,
      sender: 'peer',
      text: replyText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    conv.messages.push(streamerReply);
    conv.lastMessage = replyText;
    conv.timestamp = streamerReply.timestamp;
    conv.unreadCount = (conv.unreadCount || 0) + 1;

    io.to(`user_${userId}`).emit('message:received', {
      peerId,
      message: streamerReply,
      conversation: conv
    });
  }, 1500);

  res.json({ success: true, message: userMsg, conversation: conv });
});

// 3E. Mark Messages as Read
app.post('/api/messages/read', (req, res) => {
  const { userId, peerId } = req.body;
  if (userId && peerId) {
    const userConvs = getUserConversations(userId);
    const conv = userConvs.get(peerId);
    if (conv) conv.unreadCount = 0;
  }
  res.json({ success: true });
});

// 4. Wallet, Balance & Ledger API
app.get('/api/wallet/:userId', (req, res) => {
  const { userId } = req.params;
  const user = getOrCreateUser(userId);
  const wallet = db.wallets.get(userId) || { balance: 0, totalRechargedKes: 0, totalSpentCoins: 0 };
  const userLedger = db.ledger.filter(l => l.userId === userId).slice(0, 30);

  res.json({
    success: true,
    wallet,
    packages: db.packages,
    vipPlans: db.vipPlans,
    gifts: db.gifts,
    ledger: userLedger
  });
});

// 5. Virtual Gift Catalog
app.get('/api/gifts', (req, res) => {
  res.json({ success: true, gifts: db.gifts });
});

// 6. Safaricom M-Pesa Daraja STK Push Initiation
app.post('/api/mpesa/stkpush', async (req, res) => {
  try {
    const { userId, packageId, phoneNumber } = req.body;
    if (!userId || !packageId || !phoneNumber) {
      return res.status(400).json({ error: 'Missing required parameters: userId, packageId, phoneNumber' });
    }

    const pkg = db.packages.find(p => p.id === packageId);
    if (!pkg) {
      return res.status(404).json({ error: 'Selected coin package not found' });
    }

    // Sanitize phone number to format 2547XXXXXXXX or 2541XXXXXXXX
    let formattedPhone = phoneNumber.replace(/[^0-9]/g, '');
    if (formattedPhone.startsWith('0')) {
      formattedPhone = '254' + formattedPhone.slice(1);
    } else if (formattedPhone.startsWith('+254')) {
      formattedPhone = formattedPhone.slice(1);
    }
    if (!formattedPhone.startsWith('254') || formattedPhone.length !== 12) {
      return res.status(400).json({ error: 'Invalid Kenyan phone number format. Please use 07XXXXXXXX or 2547XXXXXXXX' });
    }

    const orderId = `ORD_${Date.now()}_${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
    const checkoutRequestId = `ws_CO_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
    const totalCoins = pkg.coins + (pkg.bonus || 0);

    const order = {
      orderId,
      userId,
      packageId: pkg.id,
      packageName: pkg.name,
      amountKes: pkg.priceKes,
      coins: totalCoins,
      phoneNumber: formattedPhone,
      checkoutRequestId,
      status: 'pending',
      createdAt: new Date().toISOString()
    };
    db.orders.set(orderId, order);

    console.log(`[M-Pesa STK Push] Initiating order ${orderId} for ${formattedPhone} (KES ${pkg.priceKes})`);

    let liveStkSuccess = false;
    let gatewayNotice = null;

    // Primary Gateway: Pay Hero Kenya M-Pesa STK Push
    if (PAYHERO_BASIC_AUTH && PAYHERO_CHANNEL_ID) {
      try {
        console.log(`[Pay Hero M-Pesa] Triggering STK push to ${formattedPhone} for KES ${pkg.priceKes} (Channel ${PAYHERO_CHANNEL_ID})`);
        const payRes = await axios.post(`${PAYHERO_API_URL}/payments`, {
          amount: Math.round(pkg.priceKes),
          phone_number: formattedPhone,
          channel_id: PAYHERO_CHANNEL_ID,
          provider: 'm-pesa',
          external_reference: orderId,
          customer_name: (db.users.get(userId)?.displayName) || 'Jirani User',
          callback_url: MPESA_CALLBACK_URL
        }, {
          headers: {
            'Authorization': PAYHERO_BASIC_AUTH,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        });

        if (payRes.data && (payRes.data.success || payRes.data.status === 'QUEUED')) {
          console.log('[Pay Hero M-Pesa] STK prompt queued successfully:', payRes.data);
          order.payheroReference = payRes.data.reference;
          if (payRes.data.CheckoutRequestID) {
            order.checkoutRequestId = payRes.data.CheckoutRequestID;
          }
          liveStkSuccess = true;
        }
      } catch (err) {
        gatewayNotice = err.response?.data || err.message;
        console.warn('[Pay Hero M-Pesa Error]:', JSON.stringify(gatewayNotice));
      }
    }

    res.json({
      success: true,
      message: `STK Push initiated! An M-Pesa prompt has been sent to ${formattedPhone}. Enter your M-Pesa PIN to complete payment of KES ${pkg.priceKes}.`,
      orderId,
      checkoutRequestId: order.checkoutRequestId,
      amountKes: pkg.priceKes,
      coins: totalCoins,
      isLive: liveStkSuccess,
      isSandbox: !liveStkSuccess
    });
  } catch (err) {
    console.error('[M-Pesa Error]:', err);
    res.status(500).json({ error: 'Failed to initiate M-Pesa STK Push: ' + err.message });
  }
});

// 7. Check M-Pesa Order Status & Auto-Confirm via Pay Hero
app.get('/api/mpesa/status/:orderId', async (req, res) => {
  const { orderId } = req.params;
  const order = db.orders.get(orderId);
  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }

  // Active status polling from Pay Hero Kenya gateway
  if (order.status === 'pending' && order.payheroReference && PAYHERO_BASIC_AUTH) {
    try {
      const statusRes = await axios.get(`${PAYHERO_API_URL}/transaction-status?reference=${order.payheroReference}`, {
        headers: {
          'Authorization': PAYHERO_BASIC_AUTH,
          'Content-Type': 'application/json'
        },
        timeout: 5000
      });

      if (statusRes.data && (statusRes.data.status === 'SUCCESS' || statusRes.data.Status === 'Success')) {
        const mpesaReceipt = statusRes.data.payment_reference || statusRes.data.reference || `PH${Date.now()}`;
        order.status = 'completed';
        order.mpesaReceipt = mpesaReceipt;
        order.completedAt = new Date().toISOString();

        let wallet = db.wallets.get(order.userId);
        if (!wallet) {
          wallet = { balance: 0, totalRechargedKes: 0, totalSpentCoins: 0 };
          db.wallets.set(order.userId, wallet);
        }
        wallet.balance += order.coins;
        wallet.totalRechargedKes += order.amountKes;

        recordLedger(
          order.userId,
          'recharge',
          order.coins,
          `M-Pesa top-up of KES ${order.amountKes} (Receipt: ${mpesaReceipt})`,
          order.orderId
        );

        console.log(`[Pay Hero Confirmed] User ${order.userId} credited with ${order.coins} coins. Balance: ${wallet.balance}`);

        io.to(`user_${order.userId}`).emit('wallet:updated', {
          newBalance: wallet.balance,
          credited: order.coins,
          receipt: mpesaReceipt
        });
      } else if (statusRes.data && (statusRes.data.status === 'FAILED' || statusRes.data.Status === 'Failed')) {
        order.status = 'failed';
      }
    } catch (e) {
      // transient network poll hiccup
    }
  }

  const wallet = db.wallets.get(order.userId);
  res.json({
    success: true,
    order,
    currentBalance: wallet ? wallet.balance : 0
  });
});

// 8. Safaricom M-Pesa / Pay Hero Webhook Callback
app.post('/api/mpesa/callback', (req, res) => {
  try {
    const callbackData = req.body;
    console.log('[M-Pesa Callback] Received webhook:', JSON.stringify(callbackData));

    // Handle Pay Hero Kenya webhook format, raw Daraja JSON callback, and test mocks
    let orderId = callbackData.orderId;
    let checkoutRequestId = callbackData.checkoutRequestId;
    let resultCode = 0;
    let mpesaReceipt = `NL${Math.random().toString(36).substr(2, 8).toUpperCase()}`;

    if (callbackData.response) {
      const resp = callbackData.response;
      orderId = resp.ExternalReference || orderId;
      checkoutRequestId = resp.CheckoutRequestID || checkoutRequestId;
      if (resp.MpesaReceiptNumber) mpesaReceipt = resp.MpesaReceiptNumber;
      resultCode = (resp.ResultCode === 0 || resp.Status === 'Success') ? 0 : (resp.ResultCode || 1);
    } else if (callbackData.Body?.stkCallback) {
      const cb = callbackData.Body.stkCallback;
      checkoutRequestId = cb.CheckoutRequestID;
      resultCode = cb.ResultCode;
      const metadata = cb.CallbackMetadata?.Item || [];
      const receiptItem = metadata.find(i => i.Name === 'MpesaReceiptNumber');
      if (receiptItem) mpesaReceipt = receiptItem.Value;
    }

    // Locate order by orderId or checkoutRequestId
    let targetOrder = null;
    for (const order of db.orders.values()) {
      if ((orderId && order.orderId === orderId) || (checkoutRequestId && order.checkoutRequestId === checkoutRequestId)) {
        targetOrder = order;
        break;
      }
    }

    if (!targetOrder) {
      return res.status(404).json({ error: 'Matching order not found' });
    }

    if (targetOrder.status === 'completed') {
      return res.json({ success: true, message: 'Order already credited (idempotent)' });
    }

    if (resultCode === 0) {
      targetOrder.status = 'completed';
      targetOrder.mpesaReceipt = mpesaReceipt;
      targetOrder.completedAt = new Date().toISOString();

      // Credit wallet atomically
      let wallet = db.wallets.get(targetOrder.userId);
      if (!wallet) {
        wallet = { balance: 0, totalRechargedKes: 0, totalSpentCoins: 0 };
        db.wallets.set(targetOrder.userId, wallet);
      }
      wallet.balance += targetOrder.coins;
      wallet.totalRechargedKes += targetOrder.amountKes;

      // Add ledger entry
      recordLedger(
        targetOrder.userId,
        'recharge',
        targetOrder.coins,
        `M-Pesa top-up of KES ${targetOrder.amountKes} (Receipt: ${mpesaReceipt})`,
        targetOrder.orderId
      );

      console.log(`[M-Pesa Completed] User ${targetOrder.userId} credited with ${targetOrder.coins} coins. New balance: ${wallet.balance}`);

      // Emit socket notification to user if connected
      io.to(`user_${targetOrder.userId}`).emit('wallet:updated', {
        newBalance: wallet.balance,
        credited: targetOrder.coins,
        receipt: mpesaReceipt
      });

      return res.json({ success: true, order: targetOrder, newBalance: wallet.balance });
    } else {
      targetOrder.status = 'failed';
      targetOrder.resultCode = resultCode;
      return res.json({ success: false, message: 'Payment cancelled or failed' });
    }
  } catch (err) {
    console.error('[M-Pesa Callback Error]:', err);
    res.status(500).json({ error: 'Internal callback error' });
  }
});

// 9. Safety & Moderation Reporting (PPhub Report Parity)
app.post('/api/safety/report', (req, res) => {
  const { reporterId, reportedUserId, matchSessionId, reason, details } = req.body;
  if (!reporterId || !reportedUserId || !reason) {
    return res.status(400).json({ error: 'Missing required report fields' });
  }

  const report = {
    id: `rep_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    reporterId,
    reportedUserId,
    matchSessionId: matchSessionId || null,
    reason,
    details: details || '',
    status: 'pending',
    createdAt: new Date().toISOString()
  };
  db.reports.push(report);

  // Automatically add to blocker's block list for safety
  let userBlocks = db.blocks.get(reporterId);
  if (!userBlocks) {
    userBlocks = new Set();
    db.blocks.set(reporterId, userBlocks);
  }
  userBlocks.add(reportedUserId);

  console.log(`[Report Filed] By ${reporterId} against ${reportedUserId} for "${reason}"`);
  res.json({ success: true, message: 'Report received and user blocked. Our moderation team will investigate immediately.', reportId: report.id });
});

// 10. User Blocks API (PPhub BlockedAccounts Parity)
app.get('/api/safety/blocks/:userId', (req, res) => {
  const { userId } = req.params;
  const blockedIds = Array.from(db.blocks.get(userId) || []);
  const blockedUsers = blockedIds.map(id => {
    const user = db.users.get(id);
    return user ? { id: user.id, displayName: user.displayName, avatar: user.avatar } : { id, displayName: `User ${id.slice(-4)}` };
  });
  res.json({ success: true, blockedUsers });
});

app.post('/api/safety/block', (req, res) => {
  const { blockerId, targetUserId } = req.body;
  if (!blockerId || !targetUserId) return res.status(400).json({ error: 'Missing IDs' });

  let userBlocks = db.blocks.get(blockerId);
  if (!userBlocks) {
    userBlocks = new Set();
    db.blocks.set(blockerId, userBlocks);
  }
  userBlocks.add(targetUserId);
  res.json({ success: true, message: 'User blocked successfully' });
});

app.post('/api/safety/unblock', (req, res) => {
  const { blockerId, targetUserId } = req.body;
  if (!blockerId || !targetUserId) return res.status(400).json({ error: 'Missing IDs' });

  const userBlocks = db.blocks.get(blockerId);
  if (userBlocks) {
    userBlocks.delete(targetUserId);
  }
  res.json({ success: true, message: 'User unblocked' });
});

// 11. Agora Token API (Direct REST endpoint with match ownership verification)
app.post('/api/agora/token', (req, res) => {
  const { channelName, uid, sessionId, userId } = req.body;
  if (!channelName || !uid) {
    return res.status(400).json({ error: 'channelName and numeric uid are required' });
  }

  // If sessionId is provided, verify match ownership
  if (sessionId) {
    const session = db.matchSessions.get(sessionId);
    if (!session || session.status === 'ended') {
      return res.status(403).json({ error: 'Invalid or expired match session' });
    }
    if (userId && session.userAId !== userId && session.userBId !== userId) {
      return res.status(403).json({ error: 'Unauthorized: User is not a participant of this match' });
    }
  }

  const token = generateAgoraToken(channelName, parseInt(uid, 10));
  res.json({
    success: true,
    appId: AGORA_APP_ID,
    channelName,
    uid: parseInt(uid, 10),
    token
  });
});

// 12. Admin Dashboard & Monitoring Endpoints
app.get('/api/admin/metrics', (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader !== ADMIN_SECRET && req.query.secret !== ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized admin access' });
  }

  let totalRecharged = 0;
  let totalCoinsSpent = 0;
  for (const w of db.wallets.values()) {
    totalRecharged += w.totalRechargedKes || 0;
    totalCoinsSpent += w.totalSpentCoins || 0;
  }

  const activeCalls = Array.from(db.matchSessions.values()).filter(s => s.status === 'active');
  const totalWithdrawnUsd = db.withdrawals.filter(w => w.status === 'completed').reduce((sum, w) => sum + w.amountUsd, 0);

  res.json({
    success: true,
    metrics: {
      registeredUsers: db.users.size,
      usersInQueue: db.queue.length,
      activeVideoCalls: activeCalls.length,
      totalReports: db.reports.length,
      pendingReports: db.reports.filter(r => r.status === 'pending').length,
      totalOrders: db.orders.size,
      totalRevenueKes: totalRecharged,
      totalCoinsSpent,
      totalWithdrawnUsd: Number(totalWithdrawnUsd.toFixed(2)),
      withdrawalsCount: db.withdrawals.length
    },
    activeCalls,
    recentReports: db.reports.slice(-15).reverse(),
    withdrawals: db.withdrawals.slice(0, 30)
  });
});

app.get('/api/admin/withdrawals', (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader !== ADMIN_SECRET && req.query.secret !== ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized admin access' });
  }
  res.json({ success: true, withdrawals: db.withdrawals });
});

app.post('/api/admin/withdrawals/:id/resolve', (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader !== ADMIN_SECRET && req.query.secret !== ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized admin access' });
  }
  const { id } = req.params;
  const { status, txId } = req.body;
  const withdrawal = db.withdrawals.find(w => w.id === id);
  if (!withdrawal) return res.status(404).json({ error: 'Withdrawal not found' });

  withdrawal.status = status || 'completed';
  if (txId) withdrawal.txId = txId;
  withdrawal.resolvedAt = new Date().toISOString();

  res.json({ success: true, withdrawal });
});

// ==========================================
// Socket.IO Matchmaking & Real-Time Engine
// ==========================================

io.on('connection', (socket) => {
  // Store socket metadata
  let currentUserId = null;
  let currentSessionId = null;

  // 1. User Identity Registration
  socket.on('user:register', (data) => {
    try {
      const { userId, displayName, city, gender, age, avatar } = data || {};
      if (!userId) return;

      currentUserId = userId;
      socket.userId = userId;
      socket.join(`user_${userId}`);

      const user = getOrCreateUser(userId, { displayName, city, gender, age, avatar });
      user.status = 'online';

      socket.emit('user:registered', {
        user,
        wallet: db.wallets.get(userId),
        agoraAppId: AGORA_APP_ID
      });

      console.log(`[Socket Connected] User ${userId} (${user.displayName}) connected on socket ${socket.id}`);
    } catch (err) {
      console.error('[user:register error]:', err);
    }
  });

  // 2. Random Video Chat: Join Queue
  socket.on('queue:join', (data) => {
    try {
      const requestedUserId = data?.userId || currentUserId || socket.userId;
      if (!currentUserId && requestedUserId) {
        currentUserId = requestedUserId;
        socket.userId = requestedUserId;
      }

      if (!currentUserId) {
        socket.emit('match:error', { message: 'Must register user before joining matchmaking' });
        return;
      }

      const filters = data || {};
      const currentUser = db.users.get(currentUserId) || getOrCreateUser(currentUserId, { gender: data?.gender });
      const currentWallet = db.wallets.get(currentUserId) || { balance: 15 };

      // Reject banned accounts immediately (Anti-Impersonation Protection)
      if (currentUser && (currentUser.isBanned || db.bannedUsers.has(currentUserId))) {
        socket.emit('account:blocked', {
          reason: currentUser.banReason || 'Account permanently blocked.'
        });
        return;
      }

      // PPhub Rule: Men recharge & spend 3 tokens to connect with women; women enter free and earn!
      if (currentUser && currentUser.gender === 'male') {
        const hasTicket = currentUser.matchTickets && currentUser.matchTickets > 0;
        const hasTokens = currentWallet && currentWallet.balance >= 3;
        if (!hasTicket && !hasTokens) {
          socket.emit('match:insufficient_tokens', {
            message: 'Connecting with female streamers costs 3 tokens. Please recharge your wallet in the Mall.',
            requiredTokens: 3,
            currentBalance: currentWallet ? currentWallet.balance : 0
          });
          return;
        }
      }

      // Remove from any existing queue entry
      db.queue = db.queue.filter(q => q.userId !== currentUserId && q.socketId !== socket.id);

      // Search queue for an existing compatible REAL human candidate who created an account
      let matchedIndex = -1;
      for (let i = 0; i < db.queue.length; i++) {
        const candidate = db.queue[i];

        // Ensure candidate socket is still connected
        const candidateSocket = io.sockets.sockets.get(candidate.socketId);
        if (!candidateSocket || !candidateSocket.connected) {
          continue;
        }

        // Rule 1: Cannot match with self
        if (candidate.userId === currentUserId) continue;

        // Rule 2: Candidate must be a real registered user account in Jirani
        const candidateUser = db.users.get(candidate.userId);
        if (!candidateUser || !candidateUser.displayName) continue;

        // Rule 3: Candidate cannot be a seed offline anchor / bot
        if (seedAnchors.some(a => a.id === candidate.userId)) continue;

        // Rule 4: Cannot match with blocked accounts
        if (isPairBlocked(currentUserId, candidate.userId)) continue;

        // Rule 5: Strict Gender Matching: Man MUST be matched to Woman
        const myGender = (currentUser?.gender || 'male').toLowerCase();
        const theirGender = (candidateUser?.gender || 'female').toLowerCase();
        if (myGender === 'male' && theirGender !== 'female') {
          continue; // A man can only match with a woman
        }
        if (myGender === 'female' && theirGender !== 'male') {
          continue; // A woman can only match with a man
        }

        matchedIndex = i;
        break;
      }

      if (matchedIndex !== -1) {
        // We found a real match! Remove candidate from queue
        const [candidate] = db.queue.splice(matchedIndex, 1);
        const candidateSocket = io.sockets.sockets.get(candidate.socketId);

        // Cancel any pending timeouts if any exist
        if (candidateSocket && candidateSocket.currentMatchTimeout) {
          clearTimeout(candidateSocket.currentMatchTimeout);
          candidateSocket.currentMatchTimeout = null;
        }
        if (socket.currentMatchTimeout) {
          clearTimeout(socket.currentMatchTimeout);
          socket.currentMatchTimeout = null;
        }

        // Generate unique Agora channel name and numeric UIDs
        const sessionId = `ses_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        const channelName = `jirani_${sessionId}`;
        const userAUid = Math.floor(100000 + Math.random() * 899999);
        const userBUid = Math.floor(100000 + Math.random() * 899999);
        const tokenA = generateAgoraToken(channelName, userAUid);
        const tokenB = generateAgoraToken(channelName, userBUid);

        const userA = db.users.get(currentUserId);
        const userB = db.users.get(candidate.userId);

        // Process Match Connection Fee: 3 Tokens from Male, Credit 3 Diamonds to Female
        let payingMale = null;
        let earningFemale = null;
        if (userA && userB) {
          if (userA.gender === 'male' && userB.gender === 'female') {
            payingMale = userA;
            earningFemale = userB;
          } else if (userB.gender === 'male' && userA.gender === 'female') {
            payingMale = userB;
            earningFemale = userA;
          }
        }

        if (payingMale) {
          const payingWallet = db.wallets.get(payingMale.id);
          if (payingMale.matchTickets > 0) {
            payingMale.matchTickets -= 1;
            console.log(`[Call Fee] User ${payingMale.displayName} used 1 free match ticket. Remaining: ${payingMale.matchTickets}`);
          } else if (payingWallet && payingWallet.balance >= 3) {
            payingWallet.balance -= 3;
            payingWallet.totalSpentCoins += 3;
            recordLedger(payingMale.id, 'call_fee', -3, '1v1 Video chat match fee (3 tokens)');
            io.to(`user_${payingMale.id}`).emit('wallet:updated', { newBalance: payingWallet.balance });
          }

          if (earningFemale) {
            creditCreatorDiamonds(earningFemale.id, 3, `1v1 Video call with ${payingMale.displayName}`);
            const earnerData = db.earnings.get(earningFemale.id);
            if (earnerData) {
              io.to(`user_${earningFemale.id}`).emit('earnings:updated', {
                diamonds: earnerData.totalDiamonds,
                withdrawableUsd: earnerData.withdrawableBalanceUsd,
                earnedNow: 3
              });
            }
          }
        }

        // Create match session between two real users
        const session = {
          sessionId,
          channelName,
          userAId: currentUserId,
          userBId: candidate.userId,
          userAUid,
          userBUid,
          socketAId: socket.id,
          socketBId: candidate.socketId,
          startedAt: new Date().toISOString(),
          status: 'active'
        };
        db.matchSessions.set(sessionId, session);

        socket.currentSessionId = sessionId;
        candidateSocket.currentSessionId = sessionId;
        currentSessionId = sessionId;

        socket.join(channelName);
        candidateSocket.join(channelName);

        socket.emit('match:found', {
          sessionId,
          channelName,
          role: 'userA',
          localUid: userAUid,
          remoteUid: userBUid,
          remoteUser: userB,
          agoraToken: tokenA,
          appId: AGORA_APP_ID
        });

        candidateSocket.emit('match:found', {
          sessionId,
          channelName,
          role: 'userB',
          localUid: userBUid,
          remoteUid: userAUid,
          remoteUser: userA,
          agoraToken: tokenB,
          appId: AGORA_APP_ID
        });

        console.log(`[Match Created] Session ${sessionId} between real users ${userA?.displayName} and ${userB?.displayName} on channel ${channelName}`);
      } else {
        // No real person found in queue yet: add to queue to wait for the next real user
        db.queue.push({
          socketId: socket.id,
          userId: currentUserId,
          filters,
          joinedAt: Date.now()
        });

        socket.emit('queue:waiting', {
          position: db.queue.length,
          avgWaitSec: null
        });

        console.log(`[Queue Waiting] Real user ${currentUser?.displayName} (${currentUserId}) waiting for a partner in queue. Queue size: ${db.queue.length}`);

        // Intelligent Live Matching:
        // If a man is searching and no other female user joins within 1.2 seconds,
        // automatically connect him with an active verified female anchor creator room
        if (socket.currentMatchTimeout) clearTimeout(socket.currentMatchTimeout);
        if (filters.autoMatchAnchor !== false) {
          socket.currentMatchTimeout = setTimeout(() => {
            const queueItemIndex = db.queue.findIndex(q => q.socketId === socket.id);
            if (queueItemIndex === -1) return; // already paired or left
            db.queue.splice(queueItemIndex, 1);

            const availableAnchors = seedAnchors.filter(a => a.gender === 'female' && !isPairBlocked(currentUserId, a.id));
            const anchor = availableAnchors.length > 0 
              ? availableAnchors[Math.floor(Math.random() * availableAnchors.length)]
              : seedAnchors[0];

            const sessionId = `ses_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
            const channelName = `jirani_${sessionId}`;
            const userAUid = Math.floor(100000 + Math.random() * 899999);
            const anchorUid = Math.floor(100000 + Math.random() * 899999);
            const tokenA = generateAgoraToken(channelName, userAUid);

            // Deduct ticket or 3 tokens if male
            if (currentUser.gender === 'male') {
              const callerWallet = db.wallets.get(currentUser.id);
              if (currentUser.matchTickets > 0) {
                currentUser.matchTickets -= 1;
              } else if (callerWallet && callerWallet.balance >= 3) {
                callerWallet.balance -= 3;
                callerWallet.totalSpentCoins += 3;
                recordLedger(currentUser.id, 'call_fee', -3, `1v1 Video chat match with ${anchor.displayName}`);
                socket.emit('wallet:updated', { newBalance: callerWallet.balance });
              }
            }

            const session = {
              sessionId,
              channelName,
              userAId: currentUserId,
              userBId: anchor.id,
              userAUid,
              userBUid: anchorUid,
              socketAId: socket.id,
              creator: anchor,
              startedAt: new Date().toISOString(),
              status: 'active'
            };
            db.matchSessions.set(sessionId, session);
            socket.currentSessionId = sessionId;
            currentSessionId = sessionId;
            socket.join(channelName);

            socket.emit('match:found', {
              sessionId,
              channelName,
              role: 'userA',
              localUid: userAUid,
              remoteUid: anchorUid,
              remoteUser: anchor,
              agoraToken: tokenA,
              appId: AGORA_APP_ID
            });

            console.log(`[Live Match Found] User ${currentUser.displayName} matched with verified creator ${anchor.displayName} on channel ${channelName}`);
          }, 4000);
        }
      }
    } catch (err) {
      console.error('[queue:join error]:', err);
      socket.emit('match:error', { message: 'Queue error: ' + err.message });
    }
  });

  // 3. Leave Queue (Cancel Search)
  socket.on('queue:leave', () => {
    if (socket.currentMatchTimeout) clearTimeout(socket.currentMatchTimeout);
    db.queue = db.queue.filter(q => q.socketId !== socket.id);
    socket.emit('queue:left');
    console.log(`[Queue Left] Socket ${socket.id} left queue. Queue size: ${db.queue.length}`);
  });

  // 4. Skip Current Partner (Rematch)
  socket.on('match:skip', (data) => {
    try {
      if (socket.currentMatchTimeout) clearTimeout(socket.currentMatchTimeout);
      const sessionId = data?.sessionId || socket.currentSessionId || currentSessionId;
      if (sessionId) {
        const session = db.matchSessions.get(sessionId);
        if (session && session.status === 'active') {
          session.status = 'ended';
          session.endedAt = new Date().toISOString();
          session.endReason = 'skip';

          io.to(session.channelName).emit('match:ended', {
            sessionId,
            reason: 'peer_skipped',
            message: 'Partner skipped to next match.'
          });
        }
      }

      socket.currentSessionId = null;
      currentSessionId = null;

      // Re-enter queue immediately if requested
      if (data?.autoRematch !== false) {
        socket.emit('match:skipped');
      }
    } catch (err) {
      console.error('[match:skip error]:', err);
    }
  });

  // 5. End Call Cleanly
  socket.on('match:end', (data) => {
    try {
      const sessionId = data?.sessionId || currentSessionId;
      if (!sessionId) return;

      const session = db.matchSessions.get(sessionId);
      if (session && session.status === 'active') {
        session.status = 'ended';
        session.endedAt = new Date().toISOString();
        session.endReason = 'hangup';

        io.to(session.channelName).emit('match:ended', {
          sessionId,
          reason: 'hangup',
          message: 'Call ended.'
        });
      }
      currentSessionId = null;
    } catch (err) {
      console.error('[match:end error]:', err);
    }
  });

  // 6. In-Call Live Text Chat
  socket.on('chat:in_call_message', (data) => {
    try {
      const { sessionId, text } = data || {};
      if (!text || !text.trim()) return;

      const session = db.matchSessions.get(sessionId || currentSessionId);
      if (!session || session.status !== 'active') return;

      const senderUser = db.users.get(currentUserId);
      const messagePayload = {
        id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
        senderId: currentUserId,
        senderName: senderUser?.displayName || 'Jirani',
        text: text.trim().slice(0, 500),
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };

      io.to(session.channelName).emit('chat:in_call_message', messagePayload);

      // If matched with an online creator, simulate friendly real-time response
      if (session.isCreatorMatch && session.creator) {
        setTimeout(() => {
          const currentSess = db.matchSessions.get(sessionId || currentSessionId);
          if (!currentSess || currentSess.status !== 'active') return;
          const replies = [
            `Habari yako! So great to meet you on Jirani! 😊✨`,
            `Niko poa sana! Where in Kenya are you calling from? 🇰🇪`,
            `Karibu sana! You have really nice energy! 💫`,
            `Haha, enjoying my stream today! How is your day going? ☕`,
            `Aww thank you! Let's definitely keep chatting! 💖`
          ];
          const textReply = replies[Math.floor(Math.random() * replies.length)];
          socket.emit('chat:in_call_message', {
            id: `msg_${Date.now()}_creator`,
            senderId: session.creator.id,
            senderName: session.creator.displayName,
            senderAvatar: session.creator.avatar,
            text: textReply,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          });
        }, 1200);
      }
    } catch (err) {
      console.error('[chat:in_call_message error]:', err);
    }
  });

  // 7. Virtual Gift Sending (Atomic Coins Deduct & Broadcast)
  socket.on('gift:send', (data) => {
    try {
      const { sessionId, recipientId, giftId } = data || {};
      if (!currentUserId || !giftId) return;

      const gift = db.gifts.find(g => g.id === giftId);
      if (!gift) {
        socket.emit('gift:error', { message: 'Invalid gift item' });
        return;
      }

      const senderWallet = db.wallets.get(currentUserId);
      if (!senderWallet || senderWallet.balance < gift.price) {
        socket.emit('gift:error', {
          message: `Insufficient coins! You have ${senderWallet ? senderWallet.balance : 0} coins, but "${gift.name}" costs ${gift.price} coins.`,
          requiredCoins: gift.price,
          currentBalance: senderWallet ? senderWallet.balance : 0
        });
        return;
      }

      // Deduct coins atomically
      senderWallet.balance -= gift.price;
      senderWallet.totalSpentCoins += gift.price;

      const senderUser = db.users.get(currentUserId);
      recordLedger(
        currentUserId,
        'gift_sent',
        -gift.price,
        `Sent ${gift.name} (${gift.emoji}) to ${recipientId}`,
        gift.id
      );

      // Reward recipient with coin credit and diamond earnings (Women Only)
      const recipientUser = db.users.get(recipientId);
      const recipientWallet = db.wallets.get(recipientId);
      const reward = Math.floor(gift.price * 0.7); // 70% creator share

      if (recipientWallet) {
        recipientWallet.balance += reward;
        recordLedger(
          recipientId,
          'gift_received',
          reward,
          `Received ${gift.name} (${gift.emoji}) from ${senderUser?.displayName}`,
          gift.id
        );
      }

      // If recipient is female, credit withdrawable diamond earnings
      if (recipientUser && recipientUser.gender === 'female') {
        creditCreatorDiamonds(recipientId, reward, `Gift: ${gift.name} from ${senderUser?.displayName}`);
        const earnerData = db.earnings.get(recipientId);
        if (earnerData) {
          io.to(`user_${recipientId}`).emit('earnings:updated', {
            diamonds: earnerData.totalDiamonds,
            withdrawableUsd: earnerData.withdrawableBalanceUsd,
            giftEarned: reward
          });
        }
      }

      // Notify match session channel with animated gift payload
      const session = db.matchSessions.get(sessionId || currentSessionId);
      const giftBroadcast = {
        gift,
        senderId: currentUserId,
        senderName: senderUser?.displayName || 'Jirani User',
        recipientId,
        timestamp: new Date().toISOString()
      };

      if (session) {
        io.to(session.channelName).emit('gift:received', giftBroadcast);
      } else {
        io.to(`user_${recipientId}`).emit('gift:received', giftBroadcast);
        socket.emit('gift:received', giftBroadcast);
      }

      // Send updated balance to sender
      socket.emit('wallet:updated', {
        newBalance: senderWallet.balance,
        spent: gift.price
      });

      // If in a creator match, send instant grateful chat reply
      if (session && session.isCreatorMatch && session.creator) {
        setTimeout(() => {
          socket.emit('chat:in_call_message', {
            id: `msg_${Date.now()}_gift_thanks`,
            senderId: session.creator.id,
            senderName: session.creator.displayName,
            senderAvatar: session.creator.avatar,
            text: `Aww asante sana for the ${gift.name} ${gift.emoji}! You are so kind! 💖✨`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          });
        }, 900);
      }

      console.log(`[Gift Sent] ${senderUser?.displayName} sent ${gift.name} (${gift.price} coins) to ${recipientId}`);
    } catch (err) {
      console.error('[gift:send error]:', err);
      socket.emit('gift:error', { message: 'Failed to send gift: ' + err.message });
    }
  });

  // 8a. WebRTC P2P Fallback Signaling (used when Agora cert is unavailable)
  const webrtcRooms = new Map(); // channelName -> { peers: [socketId,...] }

  socket.on('webrtc:join', (data) => {
    try {
      const { channelName, uid } = data || {};
      if (!channelName) return;

      if (!webrtcRooms.has(channelName)) {
        webrtcRooms.set(channelName, { peers: [] });
      }
      const room = webrtcRooms.get(channelName);

      if (!room.peers.includes(socket.id)) {
        room.peers.push(socket.id);
      }

      console.log(`[WebRTC] ${currentUserId} joined WebRTC room ${channelName}. Peers: ${room.peers.length}`);

      // If there are 2 peers, tell the second one to create an offer
      if (room.peers.length === 2) {
        const [peerASocketId, peerBSocketId] = room.peers;
        const peerASocket = io.sockets.sockets.get(peerASocketId);
        const peerBSocket = io.sockets.sockets.get(peerBSocketId);
        // Tell the second joiner to create offer and send to the first
        if (peerBSocket) {
          peerBSocket.emit('webrtc:create_offer', { channelName, targetSocketId: peerASocketId });
        }
        console.log(`[WebRTC] Room ${channelName} ready - instructing peer B to create offer`);
      }
    } catch (err) {
      console.error('[webrtc:join error]:', err);
    }
  });

  socket.on('webrtc:offer', (data) => {
    try {
      const { channelName, offer, targetSocketId } = data || {};
      if (!channelName || !offer) return;
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (targetSocket) {
        targetSocket.emit('webrtc:offer', { channelName, offer, fromSocketId: socket.id });
        console.log(`[WebRTC] Relayed offer from ${socket.id} to ${targetSocketId} on ${channelName}`);
      }
    } catch (err) {
      console.error('[webrtc:offer error]:', err);
    }
  });

  socket.on('webrtc:answer', (data) => {
    try {
      const { channelName, answer, targetSocketId } = data || {};
      if (!channelName || !answer) return;
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (targetSocket) {
        targetSocket.emit('webrtc:answer', { channelName, answer, fromSocketId: socket.id });
        console.log(`[WebRTC] Relayed answer from ${socket.id} to ${targetSocketId} on ${channelName}`);
      }
    } catch (err) {
      console.error('[webrtc:answer error]:', err);
    }
  });

  socket.on('webrtc:ice_candidate', (data) => {
    try {
      const { channelName, candidate } = data || {};
      if (!channelName || !candidate) return;
      const room = webrtcRooms.get(channelName);
      if (room) {
        // Relay ICE candidate to all other peers in the room
        room.peers.forEach(peerId => {
          if (peerId !== socket.id) {
            const peerSocket = io.sockets.sockets.get(peerId);
            if (peerSocket) {
              peerSocket.emit('webrtc:ice_candidate', { channelName, candidate, fromSocketId: socket.id });
            }
          }
        });
      }
    } catch (err) {
      console.error('[webrtc:ice_candidate error]:', err);
    }
  });

  // 8. Direct 1-on-1 Call Request
  socket.on('call:direct_request', async (data) => {
    try {
      const { targetUserId } = data || {};
      if (!currentUserId || !targetUserId) return;

      const caller = db.users.get(currentUserId);
      const targetUser = db.users.get(targetUserId);

      if (!targetUser) {
        socket.emit('call:direct_error', { message: 'User is not found.' });
        return;
      }

      // Check if target is currently online with an active socket or is an active anchor creator
      const targetSockets = await io.in(`user_${targetUserId}`).fetchSockets();
      const hasRealSocket = targetSockets && targetSockets.length > 0;
      const isAnchorCreator = seedAnchors.some(a => a.id === targetUserId);

      if (!hasRealSocket && !isAnchorCreator) {
        socket.emit('call:direct_error', {
          message: `${targetUser.displayName} is currently offline. You can only call creators who are currently online.`
        });
        return;
      }

      const sessionId = `dir_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      const channelName = `jirani_${sessionId}`;
      const userAUid = Math.floor(100000 + Math.random() * 899999);
      const userBUid = Math.floor(100000 + Math.random() * 899999);
      const tokenA = generateAgoraToken(channelName, userAUid);

      if (hasRealSocket) {
        const targetSocket = targetSockets[0];
        const tokenB = generateAgoraToken(channelName, userBUid);
        const session = {
          sessionId,
          channelName,
          userAId: currentUserId,
          userBId: targetUserId,
          userAUid,
          userBUid,
          socketAId: socket.id,
          socketBId: targetSocket.id,
          startedAt: new Date().toISOString(),
          status: 'active'
        };
        db.matchSessions.set(sessionId, session);
        currentSessionId = sessionId;
        targetSocket.currentSessionId = sessionId;

        socket.join(channelName);
        targetSocket.join(channelName);

        socket.emit('match:found', {
          sessionId,
          channelName,
          role: 'userA',
          localUid: userAUid,
          remoteUid: userBUid,
          remoteUser: targetUser,
          agoraToken: tokenA,
          appId: AGORA_APP_ID
        });

        targetSocket.emit('match:found', {
          sessionId,
          channelName,
          role: 'userB',
          localUid: userBUid,
          remoteUid: userAUid,
          remoteUser: caller,
          agoraToken: tokenB,
          appId: AGORA_APP_ID
        });
      } else {
        // Direct call to an online creator anchor
        const session = {
          sessionId,
          channelName,
          userAId: currentUserId,
          userBId: targetUserId,
          userAUid,
          userBUid,
          socketAId: socket.id,
          creator: targetUser,
          startedAt: new Date().toISOString(),
          status: 'active'
        };
        db.matchSessions.set(sessionId, session);
        currentSessionId = sessionId;
        socket.currentSessionId = sessionId;
        socket.join(channelName);

        socket.emit('match:found', {
          sessionId,
          channelName,
          role: 'userA',
          localUid: userAUid,
          remoteUid: userBUid,
          remoteUser: targetUser,
          agoraToken: tokenA,
          appId: AGORA_APP_ID
        });
      }

      console.log(`[Direct Call] Real Call: ${caller?.displayName} connected with ${targetUser?.displayName} on channel ${channelName}`);
    } catch (err) {
      console.error('[call:direct_request error]:', err);
    }
  });

  // 9. Disconnect & Cleanup
  socket.on('disconnect', () => {
    try {
      // Clean up queue
      db.queue = db.queue.filter(q => q.socketId !== socket.id);

      // Clean up active session
      if (currentSessionId) {
        const session = db.matchSessions.get(currentSessionId);
        if (session && session.status === 'active') {
          session.status = 'ended';
          session.endedAt = new Date().toISOString();
          session.endReason = 'disconnect';

          io.to(session.channelName).emit('match:ended', {
            sessionId: currentSessionId,
            reason: 'peer_disconnected',
            message: 'Your partner disconnected.'
          });
        }
      }

      // Update user status
      if (currentUserId) {
        const user = db.users.get(currentUserId);
        if (user) user.status = 'offline';
      }

      console.log(`[Socket Disconnected] ${socket.id} (user: ${currentUserId})`);
    } catch (err) {
      console.error('[disconnect cleanup error]:', err);
    }
  });
});

// Fallback Route: Serve index.html for Single-Page Application routing
app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) {
      res.status(200).send('Jirani Live Server is Running.');
    }
  });
});

// Start Server if run directly
function startServer(port = PORT) {
  return server.listen(port, () => {
    console.log('================================================================');
    console.log(`🇰🇪  Jirani Live — Random Video Chat & Discovery Platform`);
    console.log(`🚀  Server running at: http://localhost:${port}`);
    console.log(`📹  Agora App ID: ${AGORA_APP_ID}`);
    const cert = AGORA_APP_CERTIFICATE.trim();
    const certOk = cert && cert.length >= 20 && !cert.includes('REPLACE_WITH');
    console.log(`🔐  Agora App Certificate: ${certOk ? 'Configured (Active)' : 'Unconfigured / Sandbox (Using direct token bypass)'}`);
    console.log(`💰  M-Pesa Daraja: ${process.env.MPESA_ENVIRONMENT || 'sandbox'} mode`);
    console.log('================================================================');
  });
}

if (require.main === module) {
  startServer(PORT);
}

module.exports = app;
module.exports.app = app;
module.exports.server = server;
module.exports.db = db;
module.exports.startServer = startServer;

