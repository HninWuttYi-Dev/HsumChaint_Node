import { describe, expect, it, mock } from 'bun:test';
import type { PrismaClient } from 'prisma-client';
import { createSpaceService } from './space.service';

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing test fixture');
  return value;
}

function fixture() {
  const spaces = new Map([
    [1, { id: 1, ownerId: 10, revision: 0 }],
    [2, { id: 2, ownerId: 20, revision: 0 }],
  ]);
  const grants = new Map([
    [1, ['Space.View', 'Space.Post.Create']],
    [2, ['Space.View']],
  ]);
  let active = true;
  let admin = false;
  const db = {
    user: {
      findFirst: mock(async () =>
        active ? { id: 10, userType: 'Monk', systemRoles: admin ? [{}] : [] } : null
      ),
    },
    monasterySpace: {
      findUnique: mock(
        async ({ where }: { where: { id: number } }) => spaces.get(where.id) ?? null
      ),
      update: mock(async ({ where }: { where: { id: number } }) => {
        const space = required(spaces.get(where.id));
        space.revision++;
        return space;
      }),
      create: mock(async (args: unknown) => args),
    },
    permission: { upsert: mock(async () => ({})) },
    spaceMembership: {
      findUnique: mock(async ({ where }: { where: { spaceId_userId: { spaceId: number } } }) => ({
        role: {
          permissions: (grants.get(where.spaceId_userId.spaceId) ?? []).map((permissionKey) => ({
            permissionKey,
          })),
        },
      })),
    },
    role: { findFirst: mock(async (_args: unknown) => null) },
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(db),
  };
  const entries = new Map<string, string>();
  const cache = {
    get: mock(async (key: string) => entries.get(key) ?? null),
    set: mock(async (key: string, value: string) => {
      entries.set(key, value);
    }),
  };
  return {
    db,
    cache,
    spaces,
    grants,
    service: createSpaceService(db as unknown as PrismaClient, cache),
    deactivate: () => {
      active = false;
    },
    makeAdmin: () => {
      admin = true;
    },
  };
}

describe('space authorization', () => {
  it('bypasses permissions for the owner without a membership', async () => {
    const f = fixture();
    await f.service.authorize(10, 1, 'Space.Role.Manage', true);
    expect(f.db.spaceMembership.findUnique).not.toHaveBeenCalled();
  });
  it('bypasses permissions for a database-backed global system admin', async () => {
    const f = fixture();
    f.makeAdmin();
    await f.service.authorize(99, 2, 'Space.Role.Manage', true);
    expect(f.db.spaceMembership.findUnique).not.toHaveBeenCalled();
  });
  it('isolates the same user permissions between spaces, including cache entries', async () => {
    const f = fixture();
    await f.service.authorize(99, 1, 'Space.Post.Create');
    await expect(f.service.authorize(99, 2, 'Space.Post.Create')).rejects.toThrow(
      'Space permission denied'
    );
    await f.service.authorize(99, 2, 'Space.View');
    expect(f.db.spaceMembership.findUnique).toHaveBeenCalledTimes(2);
  });
  it('makes stale cached permissions unreachable after a revision change', async () => {
    const f = fixture();
    await f.service.authorize(99, 1, 'Space.Post.Create');
    f.grants.set(1, ['Space.View']);
    required(f.spaces.get(1)).revision++;
    await expect(f.service.authorize(99, 1, 'Space.Post.Create')).rejects.toThrow(
      'Space permission denied'
    );
    await f.service.authorize(99, 2, 'Space.View');
  });
  it('denies removed memberships and deleted users even with cached grants', async () => {
    const f = fixture();
    await f.service.authorize(99, 1, 'Space.Post.Create');
    f.grants.delete(1);
    required(f.spaces.get(1)).revision++;
    await expect(f.service.authorize(99, 1, 'Space.View')).rejects.toThrow(
      'Space permission denied'
    );
    f.deactivate();
    await expect(f.service.authorize(10, 1, 'Space.View')).rejects.toThrow('Unauthorized');
  });
  it('keeps role customization owner-only regardless of assigned permissions', async () => {
    const f = fixture();
    f.grants.set(1, ['Space.Role.Manage']);
    await expect(f.service.roles(99, 1)).rejects.toThrow('Only the space owner');
  });
  it('fails closed for missing spaces and works during a Redis outage', async () => {
    const f = fixture();
    f.cache.get.mockImplementation(async () => {
      throw new Error('offline');
    });
    await f.service.authorize(99, 1, 'Space.Post.Create');
    await expect(f.service.authorize(99, 2, 'Space.Post.Create')).rejects.toThrow(
      'Space permission denied'
    );
    await expect(f.service.authorize(99, 3, 'Space.View')).rejects.toThrow('Space not found');
  });
  it('creates all three default roles and permissions in the space transaction', async () => {
    const f = fixture();
    await f.service.create(10, { name: 'Monastery' });
    const args = required(f.db.monasterySpace.create.mock.calls[0])[0] as {
      data: {
        ownerId: number;
        roles: { create: { name: string; permissions: { create: unknown[] } }[] };
      };
    };
    expect(args.data.ownerId).toBe(10);
    expect(args.data.roles.create.map((r) => r.name)).toEqual([
      'Space Admin',
      'Space Editor',
      'Space Viewer',
    ]);
    expect(args.data.roles.create.every((r) => r.permissions.create.length > 0)).toBe(true);
  });
  it('rejects role IDs from another space', async () => {
    const f = fixture();
    await expect(
      f.service.saveRole(10, 1, { name: 'Coordinator', permissions: ['Space.View'] }, 42)
    ).rejects.toThrow('Space role not found');
    expect(f.db.role.findFirst.mock.calls[0]).toEqual([{ where: { id: 42, spaceId: 1 } }]);
  });
  it('protects ownership from membership reassignment or removal', async () => {
    const f = fixture();
    await expect(f.service.setMember(10, 1, 10, 42, false)).rejects.toThrow(
      'owner cannot be reassigned'
    );
    await expect(f.service.removeMember(10, 1, 10)).rejects.toThrow('owner cannot be removed');
  });
});
