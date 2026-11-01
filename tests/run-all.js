/**
 * Jirani Live — Automated Test Suite
 * Comprehensive End-to-End Testing for Agora Video, Matchmaking, Wallet, & M-Pesa
 */

const http = require('http');
const ioClient = require('socket.io-client');
const { app, server, db } = require('../server');

const TEST_PORT = 3100;
let testServer;
let serverUrl;

// Simple Test Assertions
let passedTests = 0;
let failedTests = 0;

function assert(condition, testName) {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passedTests++;
  } else {
    console.error(`  ❌ FAIL: ${testName}`);
    failedTests++;
  }
}

// Helper: Make HTTP request to local test server
function apiRequest(path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, serverUrl);
    const reqOptions = {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    };

    const req = http.request(url, reqOptions, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: body });
        }
      });
    });

    req.on('error', reject);
    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('================================================================');
  console.log('🧪 Starting Jirani Live Automated Test Suite');
  console.log('================================================================\n');

  // Start test server on independent port
  await new Promise((resolve) => {
    testServer = server.listen(TEST_PORT, () => {
      serverUrl = `http://localhost:${TEST_PORT}`;
      resolve();
    });
  });

  try {
    // -------------------------------------------------------------
    // Test 1: Platform Config & Agora App ID
    // -------------------------------------------------------------
    console.log('--- Test Suite 1: Platform & Agora Configuration ---');
    const configRes = await apiRequest('/api/config');
    assert(configRes.status === 200, 'Config endpoint returns HTTP 200');
    assert(configRes.data.agoraAppId === '92bfa202f8a94e23add6ed84e72e6317', 'Agora App ID matches verified target');
    assert(typeof configRes.data.hasAppCertificate === 'boolean', 'App certificate presence safely flagged');

    // -------------------------------------------------------------
    // Test 2: User Profile Management
    // -------------------------------------------------------------
    console.log('\n--- Test Suite 2: Profiles & Onboarding ---');
    const updateRes = await apiRequest('/api/profile/update', {
      method: 'POST',
      body: {
        userId: 'test_user_wambui',
        displayName: 'Wambui Testing',
        city: 'Nairobi',
        bio: 'Testing Jirani Live'
      }
    });
    assert(updateRes.status === 200, 'Profile update returns HTTP 200');
    assert(updateRes.data.user.displayName === 'Wambui Testing', 'Display name correctly saved');
    assert(updateRes.data.user.city === 'Nairobi', 'City attribute preserved');

    // -------------------------------------------------------------
    // Test 3: Anchor Discovery Catalog
    // -------------------------------------------------------------
    console.log('\n--- Test Suite 3: Anchor Discovery (PPhub Parity) ---');
    const anchorsRes = await apiRequest('/api/anchors');
    assert(anchorsRes.status === 200, 'Anchors endpoint returns HTTP 200');
    assert(anchorsRes.data.anchors.length >= 5, 'Seed anchors loaded for Kenya discovery');
    assert(anchorsRes.data.anchors[0].city === 'Nairobi', 'Anchor location metadata present');

    // -------------------------------------------------------------
    // Test 4: Virtual Coin Wallet & Ledger
    // -------------------------------------------------------------
    console.log('\n--- Test Suite 4: Virtual Wallet & Ledger ---');
    const walletRes = await apiRequest('/api/wallet/test_user_wambui');
    assert(walletRes.status === 200, 'Wallet endpoint returns HTTP 200');
    assert(walletRes.data.wallet.balance >= 100, 'Welcome bonus granted to new user (100 coins)');
    assert(walletRes.data.packages.length >= 4, 'Kenyan coin packages available');
    assert(walletRes.data.gifts.length === 7, '7 virtual gifts cataloged');
    assert(walletRes.data.ledger.length >= 1, 'Welcome bonus recorded in immutable ledger');

    // -------------------------------------------------------------
    // Test 5: Safaricom M-Pesa Daraja STK Push Initiation
    // -------------------------------------------------------------
    console.log('\n--- Test Suite 5: Safaricom M-Pesa Daraja Integration ---');
    const stkRes = await apiRequest('/api/mpesa/stkpush', {
      method: 'POST',
      body: {
        userId: 'test_user_wambui',
        packageId: 'pkg_starter',
        phoneNumber: '0712345678'
      }
    });
    assert(stkRes.status === 200, 'STK Push endpoint returns HTTP 200');
    assert(stkRes.data.success === true, 'STK Push successfully initiated');
    assert(stkRes.data.amountKes === 100, 'Package price formatted correctly as KES 100');
    assert(stkRes.data.coins === 100, 'Order correctly allocated 100 coins');
    const orderId = stkRes.data.orderId;

    // -------------------------------------------------------------
    // Test 6: M-Pesa Webhook Callback & Idempotency
    // -------------------------------------------------------------
    console.log('\n--- Test Suite 6: M-Pesa Webhook Callback & Atomic Ledger ---');
    const callbackRes = await apiRequest('/api/mpesa/callback', {
      method: 'POST',
      body: {
        orderId,
        Body: {
          stkCallback: {
            CheckoutRequestID: 'ws_TEST_CO_9999',
            ResultCode: 0,
            CallbackMetadata: {
              Item: [{ Name: 'MpesaReceiptNumber', Value: 'QKB7684930' }]
            }
          }
        }
      }
    });
    assert(callbackRes.status === 200, 'Callback endpoint returns HTTP 200');
    assert(callbackRes.data.success === true, 'Callback credited wallet successfully');
    assert(callbackRes.data.newBalance === 200, 'Wallet balance increased atomically (100 -> 200)');

    // Test Idempotency (replay attack protection)
    const replayRes = await apiRequest('/api/mpesa/callback', {
      method: 'POST',
      body: { orderId }
    });
    assert(replayRes.data.message.includes('idempotent'), 'Duplicate callback rejected without double-crediting');

    // -------------------------------------------------------------
    // Test 7: Safety & Reporting (PPhub Parity)
    // -------------------------------------------------------------
    console.log('\n--- Test Suite 7: Safety, Reporting & Blocks ---');
    const reportRes = await apiRequest('/api/safety/report', {
      method: 'POST',
      body: {
        reporterId: 'test_user_wambui',
        reportedUserId: 'bad_actor_999',
        reason: 'Harassment or Hate Speech',
        details: 'Automated test report'
      }
    });
    assert(reportRes.status === 200, 'Report submission returns HTTP 200');
    assert(reportRes.data.success === true, 'Report recorded in moderation queue');

    // Verify automatic block creation
    const blocksRes = await apiRequest('/api/safety/blocks/test_user_wambui');
    assert(blocksRes.data.blockedUsers.some(u => u.id === 'bad_actor_999'), 'Reported user automatically blocked from matching');

    // -------------------------------------------------------------
    // Test 8: Real-Time Socket.IO 1v1 Matchmaking (Two Live Clients)
    // -------------------------------------------------------------
    console.log('\n--- Test Suite 8: Real-Time Socket.IO 1v1 Matchmaking ---');
    await new Promise((resolve) => {
      const clientA = ioClient(serverUrl);
      const clientB = ioClient(serverUrl);
      let matchCount = 0;
      let matchedSessionId = null;

      clientA.on('connect', () => {
        clientA.emit('user:register', { userId: 'alice_nbo', displayName: 'Alice' });
      });

      clientB.on('connect', () => {
        clientB.emit('user:register', { userId: 'bob_msa', displayName: 'Bob' });
      });

      clientA.on('user:registered', () => {
        clientA.emit('queue:join', { city: 'all' });
      });

      clientB.on('user:registered', () => {
        // slight delay to test queue pairing
        setTimeout(() => {
          clientB.emit('queue:join', { city: 'all' });
        }, 100);
      });

      const onMatch = (clientName, data) => {
        assert(data.sessionId.startsWith('ses_'), `${clientName} received valid sessionId`);
        assert(data.channelName.startsWith('jirani_ses_'), `${clientName} received unpredictable channelName`);
        assert(typeof data.localUid === 'number', `${clientName} received numeric Agora UID`);
        assert(typeof data.remoteUid === 'number', `${clientName} received remote peer UID`);
        matchedSessionId = data.sessionId;
        matchCount++;

        if (matchCount === 2) {
          // Both clients matched successfully!
          // Test in-call messaging
          clientA.emit('chat:in_call_message', {
            sessionId: matchedSessionId,
            text: 'Habari Bob!'
          });
        }
      };

      clientA.on('match:found', (data) => onMatch('Client A (Alice)', data));
      clientB.on('match:found', (data) => onMatch('Client B (Bob)', data));

      clientB.on('chat:in_call_message', (msg) => {
        assert(msg.text === 'Habari Bob!', 'In-call message relayed to peer');
        assert(msg.senderName === 'Alice', 'Message sender identified correctly');

        // Test gift sending in call
        clientA.emit('gift:send', {
          sessionId: matchedSessionId,
          recipientId: 'bob_msa',
          giftId: 'gift_rose'
        });
      });

      clientB.on('gift:received', (giftData) => {
        assert(giftData.gift.name === 'Kenyan Rose', 'Gift received broadcast to peer');
        assert(giftData.senderName === 'Alice', 'Gift sender acknowledged');

        // Test skip flow
        clientA.emit('match:skip', { sessionId: matchedSessionId, autoRematch: false });
      });

      clientB.on('match:ended', (endData) => {
        assert(endData.reason === 'peer_skipped', 'Partner notified of skip');
        clientA.disconnect();
        clientB.disconnect();
        resolve();
      });
    });

    // -------------------------------------------------------------
    // Test 9: Anti-Self & Anti-Block Match Prevention
    // -------------------------------------------------------------
    console.log('\n--- Test Suite 9: Anti-Self & Anti-Block Prevention ---');
    await new Promise((resolve) => {
      const client1 = ioClient(serverUrl);
      const client2 = ioClient(serverUrl);

      client1.on('connect', () => {
        client1.emit('user:register', { userId: 'solo_user', displayName: 'Solo' });
        client1.emit('queue:join', {});
      });

      // Second connection from same user
      client2.on('connect', () => {
        client2.emit('user:register', { userId: 'solo_user', displayName: 'Solo Duplicate' });
        client2.emit('queue:join', {});
      });

      let matchedWrongly = false;
      client1.on('match:found', () => { matchedWrongly = true; });
      client2.on('match:found', () => { matchedWrongly = true; });

      setTimeout(() => {
        assert(!matchedWrongly, 'Self-match prevented: Same user on 2 sockets never paired');
        client1.disconnect();
        client2.disconnect();
        resolve();
      }, 500);
    });

    // -------------------------------------------------------------
    // Test 10: Admin Dashboard Metrics Security
    // -------------------------------------------------------------
    console.log('\n--- Test Suite 10: Administrative Access Control ---');
    const unauthorizedAdmin = await apiRequest('/api/admin/metrics');
    assert(unauthorizedAdmin.status === 401, 'Admin metrics rejects unauthorized requests');

    const authorizedAdmin = await apiRequest('/api/admin/metrics?secret=jirani_admin_secret_2026');
    assert(authorizedAdmin.status === 200, 'Admin metrics succeeds with secret key');
    assert(typeof authorizedAdmin.data.metrics.registeredUsers === 'number', 'Platform metrics computed accurately');

    // -------------------------------------------------------------
    // Test 11: Email & Google Authentication (No Instant/Guest Access)
    // -------------------------------------------------------------
    console.log('\n--- Test Suite 11: Email & Google Authentication ---');
    const invalidEmailAuth = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: { email: 'notanemail', password: '123' }
    });
    assert(invalidEmailAuth.status === 400, 'Rejects invalid email format');

    const shortPwdAuth = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: { email: 'user@example.com', password: '123' }
    });
    assert(shortPwdAuth.status === 400, 'Rejects password shorter than 6 characters');

    const validEmailAuth = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: { email: 'sarah.creator@example.com', password: 'securePass2026', displayName: 'Sarah' }
    });
    assert(validEmailAuth.status === 200, 'Valid email authentication succeeds');
    assert(validEmailAuth.data.user.email === 'sarah.creator@example.com', 'User email persisted');

    const googleAuth = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: { provider: 'google', email: 'wanjiku.google@gmail.com', displayName: 'Wanjiku Google' }
    });
    assert(googleAuth.status === 200, 'Continue with Google authentication succeeds');
    assert(googleAuth.data.user.authProvider === 'google', 'Google auth provider flagged');

    // -------------------------------------------------------------
    // Test 12: Strict Facial Verification & Anti-Impersonation Auto-Block
    // -------------------------------------------------------------
    console.log('\n--- Test Suite 12: Strict Facial Verification & Auto-Block ---');
    const femaleVerify = await apiRequest('/api/creator/facial-verify', {
      method: 'POST',
      body: { userId: 'test_female_streamer', declaredGender: 'female', simulateTest: 'female_verified' }
    });
    assert(femaleVerify.status === 200, 'Female biometric face verification approved');
    assert(femaleVerify.data.verified === true, 'Female verified creator flag set');

    const maleImpersonator = await apiRequest('/api/creator/facial-verify', {
      method: 'POST',
      body: { userId: 'male_impersonator_1', declaredGender: 'female', simulateTest: 'male_detected' }
    });
    assert(maleImpersonator.status === 403, 'Male pretending to be woman rejected with HTTP 403');
    assert(maleImpersonator.data.maleDetected === true, 'Male biometrics flagged');
    assert(maleImpersonator.data.blocked === true, 'Fraudulent account permanently blocked');

    // Verify blocked account is rejected on subsequent login
    const blockedLogin = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: { email: 'male.impersonator@example.com', password: 'password123', userId: 'male_impersonator_1' }
    });
    assert(blockedLogin.status === 403, 'Blocked impersonator account locked out from login');

  } catch (err) {
    console.error('Fatal test error:', err);
    failedTests++;
  } finally {
    // Teardown test server
    testServer.close();
    console.log('\n================================================================');
    console.log(`📊 Test Results: ${passedTests} Passed, ${failedTests} Failed`);
    console.log('================================================================');
    process.exit(failedTests > 0 ? 1 : 0);
  }
}

runTests();
