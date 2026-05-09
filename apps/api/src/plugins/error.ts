import fp from 'fastify-plugin';
import { ZodError } from 'zod';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { IllegalTransition } from '../lib/state.js';
import { QuotaExceeded } from '../services/appeals.js';

export default fp(async (app) => {
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      reply.code(400).send({ error: 'validation_error', issues: err.issues });
      return;
    }
    if (err instanceof IllegalTransition) {
      reply.code(409).send({ error: 'illegal_transition', message: err.message });
      return;
    }
    if (err instanceof QuotaExceeded) {
      reply.code(422).send({ error: 'quota_exceeded', message: err.message });
      return;
    }
    if (err instanceof PrismaClientKnownRequestError) {
      if (err.code === 'P2025') {
        reply.code(404).send({ error: 'not_found' });
        return;
      }
      if (err.code === 'P2002') {
        reply.code(409).send({ error: 'unique_violation', message: err.message });
        return;
      }
    }
    // Fall through to Fastify default (logs + 500)
    req.log.error({ err }, 'unhandled error');
    reply.send(err);
  });
}, { name: 'error' });
