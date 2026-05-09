// Set SESSION_SECRET if not already set (tests need a valid iron-session secret;
// real value comes from Vault in production)
if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = 'test-session-secret-32-bytes-long-enough-for-iron-session';
}

import { beforeEach, afterAll } from 'vitest';
import { clearDatabase, prisma } from './db.js';

beforeEach(async () => {
  await clearDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});
