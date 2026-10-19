import type { Prisma, PrismaClient } from 'prisma-client';
import { AppError } from '@/utils/AppError';
import { DEFAULT_SPACE_ROLES, SPACE_PERMISSIONS, type SpacePermission } from './space.permissions';

type Cache = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown>;
};
type SpaceInput = { name: string; description?: string };
type RoleInput = { name: string; permissions: SpacePermission[] };

export function createSpaceService(db: PrismaClient, cache?: Cache) {
  async function actor(userId: number) {
    const user = await db.user.findFirst({
      where: { id: userId, isDeleted: false },
      select: {
        id: true,
        userType: true,
        systemRoles: { where: { role: { spaceId: null, name: 'System Admin' } } },
      },
    });
    if (!user) throw new AppError('Unauthorized', 401);
    return user;
  }

  async function authorize(
    userId: number,
    spaceId: number,
    permission: SpacePermission,
    ownerOnly = false
  ) {
    const user = await actor(userId);
    const space = await db.monasterySpace.findUnique({ where: { id: spaceId } });
    if (!space) throw new AppError('Space not found', 404);
    if (user.systemRoles.length || space.ownerId === userId) return space;
    if (ownerOnly) throw new AppError('Only the space owner may manage roles', 403);
    // Every authorization reads the current revision. Old cache entries become unreachable
    // atomically with membership/role changes, including during concurrent requests.
    const key = `space:${spaceId}:v${space.revision}:user:${userId}`;
    let permissions: string[] | undefined;
    try {
      const cached = await cache?.get(key);
      if (cached) {
        const parsed: unknown = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string'))
          permissions = parsed;
      }
    } catch {
      /* Redis is optional; database authorization remains available. */
    }
    if (!permissions) {
      const membership = await db.spaceMembership.findUnique({
        where: { spaceId_userId: { spaceId, userId } },
        include: { role: { include: { permissions: true } } },
      });
      permissions = membership?.role.permissions.map((item) => item.permissionKey) ?? [];
      try {
        await cache?.set(key, JSON.stringify(permissions), 'EX', 60);
      } catch {
        /* Fall back to DB. */
      }
    }
    if (!permissions.includes(permission)) throw new AppError('Space permission denied', 403);
    return space;
  }

  async function mutate<T>(
    spaceId: number,
    operation: (tx: Prisma.TransactionClient) => Promise<T>
  ) {
    return db.$transaction(async (tx) => {
      // Lock the space first so membership and role mutations serialize per space.
      await tx.monasterySpace.update({
        where: { id: spaceId },
        data: { revision: { increment: 1 } },
      });
      return operation(tx);
    });
  }

  return {
    authorize,
    async create(userId: number, data: SpaceInput) {
      const user = await actor(userId);
      if (user.userType !== 'Monk') throw new AppError('Only monks may create spaces', 403);
      return db.$transaction(async (tx) => {
        for (const key of SPACE_PERMISSIONS) {
          await tx.permission.upsert({ where: { key }, update: {}, create: { key } });
        }
        return tx.monasterySpace.create({
          data: {
            ...data,
            ownerId: userId,
            roles: {
              create: DEFAULT_SPACE_ROLES.map((role) => ({
                name: role.name,
                permissions: {
                  create: role.permissions.map((permissionKey) => ({ permissionKey })),
                },
              })),
            },
          },
          include: { roles: { include: { permissions: true } } },
        });
      });
    },
    async list(userId: number, skip: number, take: number) {
      const user = await actor(userId);
      return db.monasterySpace.findMany({
        where: user.systemRoles.length
          ? {}
          : { OR: [{ ownerId: userId }, { members: { some: { userId } } }] },
        skip,
        take,
        orderBy: { id: 'desc' },
      });
    },
    async update(userId: number, spaceId: number, data: Partial<SpaceInput>) {
      await authorize(userId, spaceId, 'Space.Settings.Edit');
      return db.monasterySpace.update({ where: { id: spaceId }, data });
    },
    async remove(userId: number, spaceId: number) {
      await authorize(userId, spaceId, 'Space.Delete', true);
      return db.$transaction(async (tx) => {
        await tx.spaceMembership.deleteMany({ where: { spaceId } });
        return tx.monasterySpace.delete({ where: { id: spaceId } });
      });
    },
    async roles(userId: number, spaceId: number) {
      await authorize(userId, spaceId, 'Space.Role.Manage', true);
      return db.role.findMany({ where: { spaceId }, include: { permissions: true } });
    },
    async saveRole(userId: number, spaceId: number, data: RoleInput, roleId?: number) {
      await authorize(userId, spaceId, 'Space.Role.Manage', true);
      return mutate(spaceId, async (tx) => {
        if (roleId) {
          const role = await tx.role.findFirst({ where: { id: roleId, spaceId } });
          if (!role) throw new AppError('Space role not found', 404);
          await tx.rolePermission.deleteMany({ where: { roleId } });
          return tx.role.update({
            where: { id: roleId },
            data: {
              name: data.name,
              permissions: { create: data.permissions.map((permissionKey) => ({ permissionKey })) },
            },
            include: { permissions: true },
          });
        }
        return tx.role.create({
          data: {
            name: data.name,
            spaceId,
            permissions: { create: data.permissions.map((permissionKey) => ({ permissionKey })) },
          },
          include: { permissions: true },
        });
      });
    },
    async members(userId: number, spaceId: number, skip: number, take: number) {
      await authorize(userId, spaceId, 'Space.View');
      return db.spaceMembership.findMany({
        where: { spaceId },
        skip,
        take,
        select: {
          userId: true,
          roleId: true,
          createdAt: true,
          user: { select: { id: true, username: true, avatar: true } },
        },
        orderBy: { userId: 'asc' },
      });
    },
    async setMember(
      userId: number,
      spaceId: number,
      targetId: number,
      roleId: number,
      invite: boolean
    ) {
      const space = await authorize(
        userId,
        spaceId,
        invite ? 'Space.Member.Invite' : 'Space.Member.Manage',
        !invite
      );
      if (targetId === space.ownerId) throw new AppError('The owner cannot be reassigned', 400);
      return mutate(spaceId, async (tx) => {
        const role = await tx.role.findFirst({ where: { id: roleId, spaceId } });
        if (!role) throw new AppError('Space role not found', 404);
        // Admins may invite only Viewer/Editor-equivalent roles; custom roles must be assigned by the owner.
        const inviter = await actor(userId);
        if (space.ownerId !== userId && !inviter.systemRoles.length) {
          const permissions = await tx.rolePermission.findMany({ where: { roleId } });
          const allowed = new Set(['Space.View', 'Space.Post.Create', 'Space.Donation.Create']);
          if (permissions.some((p) => !allowed.has(p.permissionKey)))
            throw new AppError('Only the owner may assign management roles', 403);
        }
        const target = await tx.user.findFirst({ where: { id: targetId, isDeleted: false } });
        if (!target) throw new AppError('User not found', 404);
        const where = { spaceId_userId: { spaceId, userId: targetId } };
        if (invite)
          return tx.spaceMembership.create({ data: { spaceId, userId: targetId, roleId } });
        const existing = await tx.spaceMembership.findUnique({ where });
        if (!existing) throw new AppError('Member not found', 404);
        return tx.spaceMembership.update({ where, data: { roleId } });
      });
    },
    async removeMember(userId: number, spaceId: number, targetId: number) {
      const space = await authorize(userId, spaceId, 'Space.Member.Manage');
      if (targetId === space.ownerId) throw new AppError('The owner cannot be removed', 400);
      return mutate(spaceId, async (tx) => {
        const result = await tx.spaceMembership.deleteMany({
          where: { spaceId, userId: targetId },
        });
        if (!result.count) throw new AppError('Member not found', 404);
        return result;
      });
    },
  };
}
