import { beforeEach, afterAll } from 'vitest';
import { clearDatabase, prisma } from './db.js';

beforeEach(async () => {
  await clearDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});
