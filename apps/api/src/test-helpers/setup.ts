// Set SESSION_SECRET if not already set (tests need a valid iron-session secret;
// real value comes from Vault in production)
if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = 'test-session-secret-32-bytes-long-enough-for-iron-session';
}

// Set VAPID env vars for tests (generated test key pair — not used in production).
// Real VAPID keys come from Vault in production.
// Keys generated via: webpush.generateVAPIDKeys() for test use only.
if (!process.env.VAPID_PUBLIC_KEY) {
  process.env.VAPID_PUBLIC_KEY = 'BAO1SFPSt5395Gp0JTrJv1-29GFvrE1OjfNec_nxznlpBPBn7eSgx0GzTFHIifv7Kr-IZHXo-dQNr6n-TfhNLZc';
}
if (!process.env.VAPID_PRIVATE_KEY) {
  process.env.VAPID_PRIVATE_KEY = 'cr8naMBBDBCSulngKtMWxj3vmagbEj71GrRFtLLjcNA';
}
if (!process.env.VAPID_CLAIM_EMAIL) {
  process.env.VAPID_CLAIM_EMAIL = 'test@example.com';
}

import { beforeEach, afterAll } from 'vitest';
import IORedis from 'ioredis';
import { clearDatabase, prisma } from './db.js';

// Single Redis client for test-suite cleanup — one per singleFork worker.
const testRedis = new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });

beforeEach(async () => {
  await clearDatabase();
  // Flush Redis so rate-limit keys (and any other test state) don't leak
  // between tests whose DB rows share the same auto-increment IDs after RESTART IDENTITY.
  await testRedis.flushdb();
});

afterAll(async () => {
  await prisma.$disconnect();
  await testRedis.quit();
});
