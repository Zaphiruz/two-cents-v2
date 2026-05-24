import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import adminUsersRoutes from './users.js';
import adminHouseholdsRoutes from './households.js';
import adminAppealsRoutes from './appeals.js';
import adminFeedbackRoutes from './feedback.js';

export interface AdminUser {
  id: number;
  name: string;
  isAdmin: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    adminUser?: AdminUser;
  }
}

async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const userId = req.session.userId;
  if (!userId) {
    reply.code(401).send({ error: 'not_authenticated' });
    return;
  }
  const user = await req.server.prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, isAdmin: true },
  });
  if (!user?.isAdmin) {
    reply.code(403).send({ error: 'forbidden' });
    return;
  }
  req.adminUser = user;
}

export default async function adminRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAdmin);

  await app.register(adminUsersRoutes);
  await app.register(adminHouseholdsRoutes);
  await app.register(adminAppealsRoutes);
  await app.register(adminFeedbackRoutes);
}
