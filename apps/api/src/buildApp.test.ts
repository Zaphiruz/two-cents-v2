import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from './buildApp.js';
import type { FastifyInstance } from 'fastify';

describe('app boot + /healthz', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('boots and /healthz returns 200 with ok:true', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});

describe('error handler maps IllegalTransition to 409', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    app.get('/__test_illegal_transition', async () => {
      const { IllegalTransition } = await import('./lib/state.js');
      throw new IllegalTransition('test -> noop');
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 409 with illegal_transition error', async () => {
    const res = await app.inject({ method: 'GET', url: '/__test_illegal_transition' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'illegal_transition' });
  });
});

describe('error handler maps QuotaExceeded to 422', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    app.get('/__test_quota_exceeded', async () => {
      const { QuotaExceeded } = await import('./services/appeals.js');
      throw new QuotaExceeded('no appeals remaining');
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 422 with quota_exceeded error', async () => {
    const res = await app.inject({ method: 'GET', url: '/__test_quota_exceeded' });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: 'quota_exceeded' });
  });
});

describe('error handler maps Prisma P2025 to 404', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    app.get('/__test_p2025', async () => {
      const { PrismaClientKnownRequestError } = await import('@prisma/client/runtime/library');
      throw new PrismaClientKnownRequestError('record not found', { code: 'P2025', clientVersion: '5.0' });
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 404 not_found', async () => {
    const res = await app.inject({ method: 'GET', url: '/__test_p2025' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'not_found' });
  });
});

describe('error handler maps Prisma P2002 to 409', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    app.get('/__test_p2002', async () => {
      const { PrismaClientKnownRequestError } = await import('@prisma/client/runtime/library');
      throw new PrismaClientKnownRequestError('unique constraint failed', { code: 'P2002', clientVersion: '5.0' });
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 409 unique_violation', async () => {
    const res = await app.inject({ method: 'GET', url: '/__test_p2002' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'unique_violation' });
  });
});

describe('error handler maps ZodError to 400', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    app.get('/__test_zod', async () => {
      const { z } = await import('zod');
      z.object({ x: z.number() }).parse({ x: 'no' });
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 400 with validation_error', async () => {
    const res = await app.inject({ method: 'GET', url: '/__test_zod' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'validation_error' });
  });
});
