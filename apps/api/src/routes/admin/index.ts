import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import adminUsersRoutes from './users.js';

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

  // Temporary smoke endpoint, kept for monitoring. Returns the admin's id.
  app.get('/api/admin/_ping', async (req) => {
    return { ok: true, adminId: req.adminUser!.id };
  });

  await app.register(adminUsersRoutes);
}
