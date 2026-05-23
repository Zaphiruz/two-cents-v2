import fp from 'fastify-plugin';
import { ZodError } from 'zod';
import { IllegalTransition } from '../lib/state.js';
import { QuotaExceeded } from '../services/appeals.js';
import { JWTInvalidError, JWTReplayError } from '../lib/jwt.js';
import { GitHubAuthError, GitHubAPIError, GitHubNotConfigured } from '../lib/github.js';

/** Duck-type check for PrismaClientKnownRequestError.
 *
 * The strict `instanceof PrismaClientKnownRequestError` check fails in ESM
 * environments where the runtime/library is resolved differently between the
 * app bundle and the plugin import (different module instances → different
 * prototype chains). A structural check on `.code` is robust and sufficient.
 */
function isPrismaKnownError(err: unknown): err is { code: string; message: string } {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as { code: unknown }).code === 'string' &&
    (err as { constructor: { name: string } }).constructor.name === 'PrismaClientKnownRequestError'
  );
}

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
    if (err instanceof JWTInvalidError) {
      reply.code(400).send({ error: 'invalid_token', message: err.message });
      return;
    }
    if (err instanceof JWTReplayError) {
      reply.code(409).send({ error: 'token_already_used', message: err.message });
      return;
    }
    if (err instanceof GitHubAuthError) {
      reply.code(502).send({ error: 'bad_gateway', message: err.message });
      return;
    }
    if (err instanceof GitHubAPIError) {
      reply.code(502).send({ error: 'bad_gateway', message: err.message });
      return;
    }
    if (err instanceof GitHubNotConfigured) {
      reply.code(503).send({ error: 'service_unavailable', message: err.message });
      return;
    }
    if (isPrismaKnownError(err)) {
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
