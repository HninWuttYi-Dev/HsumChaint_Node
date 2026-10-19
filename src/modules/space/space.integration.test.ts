import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from 'prisma-client';
import { createSpaceService } from './space.service';

// Explicit opt-in: use a disposable MySQL database with migrations already applied.
const databaseUrl = process.env.SPACE_TEST_DATABASE_URL;

async function expectFailure(operation: Promise<unknown>, message?: string) {
  // Await real database I/O before asserting; Bun's rejection matcher can stall it on Windows.
  let failure: unknown;
  try {
    await operation;
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(Error);
  if (message) expect((failure as Error).message).toContain(message);
}
describe.skipIf(!databaseUrl)('space RBAC MySQL integration', () => {
  let db: PrismaClient;
  const users: number[] = [];
  const spaces: number[] = [];
  beforeAll(async () => {
    const url = new URL(databaseUrl ?? '');
    db = new PrismaClient({
      adapter: new PrismaMariaDb({
        host: url.hostname,
        port: Number(url.port || 3306),
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        database: url.pathname.slice(1),
        connectionLimit: 3,
      }),
    });
    for (let i = 0; i < 3; i++) {
      const user = await db.user.create({
        data: {
          phone: `space-test-${crypto.randomUUID()}`,
          username: 'Space test',
          password: 'unused',
          userType: i < 2 ? 'Monk' : 'Donor',
        },
      });
      users.push(user.id);
    }
  });
  afterAll(async () => {
    if (!db) return;
    await db.spaceMembership.deleteMany({ where: { spaceId: { in: spaces } } });
    await db.monasterySpace.deleteMany({ where: { id: { in: spaces } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  });
  it('initializes roles, enforces scoped memberships and isolates role edits', async () => {
    const service = createSpaceService(db);
    const a = await service.create(users[0], { name: 'A' });
    spaces.push(a.id);
    const b = await service.create(users[1], { name: 'B' });
    spaces.push(b.id);
    expect(a.roles).toHaveLength(3);
    expect(b.roles).toHaveLength(3);
    await service.authorize(users[0], a.id, 'Space.Role.Manage', true);
    const editor = a.roles.find((r) => r.name === 'Space Editor');
    const viewer = b.roles.find((r) => r.name === 'Space Viewer');
    if (!editor || !viewer) throw new Error('Default roles missing');
    await service.setMember(users[0], a.id, users[2], editor.id, true);
    await service.setMember(users[1], b.id, users[2], viewer.id, true);
    await service.authorize(users[2], a.id, 'Space.Post.Create');
    await expectFailure(
      service.authorize(users[2], b.id, 'Space.Post.Create'),
      'Space permission denied'
    );
    await expectFailure(
      service.setMember(users[0], a.id, users[1], viewer.id, true),
      'Space role not found'
    );
    // The composite FK also enforces scope against direct database writes.
    await expectFailure(
      db.spaceMembership.create({
        data: {
          spaceId: a.id,
          userId: users[1],
          roleId: viewer.id,
        },
      })
    );
    await service.saveRole(
      users[0],
      a.id,
      { name: editor.name, permissions: ['Space.View'] },
      editor.id
    );
    await expectFailure(
      service.authorize(users[2], a.id, 'Space.Post.Create'),
      'Space permission denied'
    );
    expect(await db.rolePermission.findMany({ where: { roleId: viewer.id } })).toHaveLength(1);
    await service.removeMember(users[0], a.id, users[2]);
    await expectFailure(service.authorize(users[2], a.id, 'Space.View'), 'Space permission denied');
    await service.authorize(users[2], b.id, 'Space.View');
  });
});
