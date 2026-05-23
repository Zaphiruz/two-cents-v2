/**
 * workers/index.ts — Standalone worker process entrypoint (Phase 8)
 *
 * This file is the entry point for a separate Node.js container:
 *   node dist/workers/index.js
 *
 * It wires up:
 *   - A dedicated PrismaClient (separate from the API server's)
 *   - A dedicated IORedis client (maxRetriesPerRequest: null, required by BullMQ)
 *   - A BullMQ Queue + Worker for "scheduled" jobs
 *   - Six repeatable jobs registered on startup
 *   - Graceful shutdown on SIGINT / SIGTERM
 *
 * The worker runs each scheduled job function directly; no job data payload is
 * needed because all state is read from the DB at execution time.
 *
 * v1 reference: apps/requests_app/tasks.py (job definitions)
 */

import { PrismaClient } from '@prisma/client';
import IORedis from 'ioredis';
import { Queue, Worker } from 'bullmq';
import pino from 'pino';

import {
  expireCooldowns,
  expireReconfirms,
  expireApprovals,
  approvalExpiringWarnings,
  stalePendingReminders,
  needRatedReminders,
} from './scheduled.js';

// ── Logger ────────────────────────────────────────────────────────────────────

const log = pino({ name: 'workers' });

// ── Connections ───────────────────────────────────────────────────────────────

const prisma = new PrismaClient();

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) throw new Error('REDIS_URL env var is required');

// BullMQ requires maxRetriesPerRequest: null
const redis = new IORedis(redisUrl, { maxRetriesPerRequest: null });

// ── Job definitions ───────────────────────────────────────────────────────────

/**
 * Maps job names to their handler functions and repeat options.
 * Cadences match v1's tasks.py comments.
 */
const JOB_DEFINITIONS = [
  {
    name: 'expireCooldowns',
    /** every 10 minutes */
    repeat: { every: 10 * 60 * 1000 },
    handler: async () => expireCooldowns(prisma),
  },
  {
    name: 'expireReconfirms',
    /** every 1 hour */
    repeat: { every: 60 * 60 * 1000 },
    handler: async () => expireReconfirms(prisma),
  },
  {
    name: 'expireApprovals',
    /** every 1 hour */
    repeat: { every: 60 * 60 * 1000 },
    handler: async () => expireApprovals(prisma),
  },
  {
    name: 'approvalExpiringWarnings',
    /** daily at 09:00 */
    repeat: { pattern: '0 9 * * *' },
    handler: async () => approvalExpiringWarnings(prisma),
  },
  {
    name: 'stalePendingReminders',
    /** every 1 hour */
    repeat: { every: 60 * 60 * 1000 },
    handler: async () => stalePendingReminders(prisma),
  },
  {
    name: 'needRatedReminders',
    /** every 30 minutes */
    repeat: { every: 30 * 60 * 1000 },
    handler: async () => needRatedReminders(prisma),
  },
] as const;

// ── Queue + Worker setup ──────────────────────────────────────────────────────

const QUEUE_NAME = 'scheduled';

const queue = new Queue(QUEUE_NAME, { connection: redis });

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const def = JOB_DEFINITIONS.find((d) => d.name === job.name);
    if (!def) {
      log.warn({ jobName: job.name }, 'Unknown job name — skipping');
      return;
    }
    log.info({ jobName: job.name }, 'Job started');
    await def.handler();
    log.info({ jobName: job.name }, 'Job completed');
  },
  { connection: redis },
);

worker.on('failed', (job, err) => {
  log.error({ jobName: job?.name, err }, 'Job failed');
});

worker.on('error', (err) => {
  log.error({ err }, 'Worker error');
});

// ── Register repeatable jobs ──────────────────────────────────────────────────

async function registerJobs(): Promise<void> {
  for (const def of JOB_DEFINITIONS) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await queue.add(def.name, {}, { repeat: def.repeat as any, jobId: def.name });
    log.info({ jobName: def.name }, 'Registered repeatable job');
  }
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, 'Shutting down workers gracefully');
  try {
    await worker.close();
    await queue.close();
    await prisma.$disconnect();
    await redis.quit();
    log.info('Shutdown complete');
  } catch (err) {
    log.error({ err }, 'Error during shutdown');
    process.exit(1);
  }
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

// ── Boot ──────────────────────────────────────────────────────────────────────

async function boot(): Promise<void> {
  log.info('Workers booting…');
  await registerJobs();
  log.info('Workers ready — repeatable jobs registered');
}

boot().catch((err) => {
  log.error({ err }, 'Worker boot failed');
  process.exit(1);
});
