import { describe, expect, mock, test } from 'bun:test';
import express from 'express';
import request from 'supertest';
import { globalErrorHandler } from '@/middlewares/errorHandler';
import { createSpaceDonationRouter } from '../donation.routes';
import { donationInput, donationQuery } from '../donation.schema';
import { createDonationService } from '../donation.service';

function fixture() {
  const row = { id: 9, monasterySpaceId: 8, donorId: 2, status: 'Pending', statusValue: 0 };
  const donorList = {
    create: mock(async (args: { data: object }) => ({ id: 9, ...args.data })),
    findFirst: mock(async (_args: unknown): Promise<typeof row | null> => ({ ...row })),
    findMany: mock(async (_args: unknown) => [{ ...row }]),
    count: mock(async (_args: unknown) => 1),
    updateMany: mock(async (_args: unknown) => ({ count: 1 })),
    findUniqueOrThrow: mock(async (_args: unknown) => ({ ...row })),
  };
  const db = {
    monasteryMember: {
      findFirst: mock(
        async (_args: unknown): Promise<{ role: number; isOwner: boolean } | null> => ({
          role: 6,
          isOwner: false,
        })
      ),
    },
    rolePermission: { count: mock(async (_args: unknown) => 1) },
    donorList,
    $transaction: async (action: unknown) =>
      typeof action === 'function'
        ? action({ donorList })
        : Promise.all(action as Promise<unknown>[]),
  };
  const service = createDonationService(
    db as unknown as Parameters<typeof createDonationService>[0]
  );
  return { db, row, service };
}

const input = {
  donationType: 'Food',
  donationTypeValue: 1,
  quantity: '10.50',
  pickupTime: '2026-12-01T08:00:00+06:30',
};

describe('space donations', () => {
  test('creates a pending donation for the authenticated member, preserving decimal precision', async () => {
    const { service, db } = fixture();
    const result = await service.create(2, 8, { ...input, amount: '9999999999999999.99' });
    expect(result).toMatchObject({
      donorId: 2,
      monasterySpaceId: 8,
      status: 'Pending',
      statusValue: 0,
      amount: '9999999999999999.99',
    });
    expect(db.donorList.create.mock.calls[0]?.[0].data).toMatchObject({
      pickupTime: new Date(input.pickupTime),
    });
    expect(db.rolePermission.count.mock.calls[0]?.[0]).toMatchObject({
      where: {
        roleId: 6,
        permission: { name: 'Space.Donation.Create', isDeleted: false },
        role: { isDeleted: false },
      },
    });
    expect(db.monasteryMember.findFirst.mock.calls[0]?.[0]).toMatchObject({
      where: {
        userId: 2,
        monasterySpaceId: 8,
        user: { isDeleted: false },
        monasterySpace: { isDeleted: false },
      },
    });
  });

  test('denies nonmembers and inactive users/spaces before writing', async () => {
    const { service, db } = fixture();
    db.monasteryMember.findFirst.mockResolvedValue(null);
    await expect(service.create(2, 8, input)).rejects.toMatchObject({ statusCode: 403 });
    expect(db.donorList.create).not.toHaveBeenCalled();
  });

  test('denies members without create permission', async () => {
    const { service, db } = fixture();
    db.rolePermission.count.mockResolvedValue(0);
    await expect(service.create(2, 8, input)).rejects.toMatchObject({ statusCode: 403 });
    expect(db.donorList.create).not.toHaveBeenCalled();
  });

  test('space owners can create without explicit role permission', async () => {
    const { service, db } = fixture();
    db.monasteryMember.findFirst.mockResolvedValue({ role: 1, isOwner: true });
    await service.create(2, 8, input);
    expect(db.rolePermission.count).not.toHaveBeenCalled();
  });

  test('lists only the requested space with bounded pagination and status filtering', async () => {
    const { service, db } = fixture();
    expect(await service.list(2, 8, { page: 2, limit: 5, status: 'Accepted' })).toMatchObject({
      total: 1,
      page: 2,
      limit: 5,
    });
    expect(db.donorList.findMany.mock.calls[0]?.[0]).toEqual({
      where: { monasterySpaceId: 8, status: 'Accepted' },
      orderBy: { id: 'desc' },
      skip: 5,
      take: 5,
    });
    expect(db.donorList.count.mock.calls[0]?.[0]).toEqual({
      where: { monasterySpaceId: 8, status: 'Accepted' },
    });
  });

  test('requires view permission for list/detail', async () => {
    const { service, db } = fixture();
    db.rolePermission.count.mockResolvedValue(0);
    await expect(service.list(2, 8, { page: 1, limit: 20 })).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(service.get(2, 8, 9)).rejects.toMatchObject({ statusCode: 403 });
    expect(db.donorList.findFirst).not.toHaveBeenCalled();
  });

  test('detail and review cannot access donations from another space', async () => {
    const { service, db } = fixture();
    db.donorList.findFirst.mockResolvedValue(null);
    await expect(service.get(2, 8, 99)).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.transition(2, 8, 99, 'Accepted')).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(db.donorList.findFirst.mock.calls[0]?.[0]).toEqual({
      where: { id: 99, monasterySpaceId: 8 },
    });
    expect(db.donorList.updateMany).not.toHaveBeenCalled();
  });

  for (const status of ['Accepted', 'Rejected'] as const) {
    test(`review records ${status} and reviewer identity atomically`, async () => {
      const { service, db } = fixture();
      await service.transition(3, 8, 9, status);
      expect(db.rolePermission.count.mock.calls[0]?.[0]).toMatchObject({
        where: { permission: { name: 'Space.Donation.Review' } },
      });
      expect(db.donorList.updateMany.mock.calls[0]?.[0]).toMatchObject({
        where: { id: 9, monasterySpaceId: 8, status: 'Pending', statusValue: 0 },
        data: {
          status,
          statusValue: status === 'Accepted' ? 1 : 2,
          reviewerId: 3,
          reviewedAt: expect.any(Date),
        },
      });
    });
  }

  test('review permission is required even if the user can create', async () => {
    const { service, db } = fixture();
    db.rolePermission.count.mockResolvedValue(0);
    await expect(service.transition(2, 8, 9, 'Accepted')).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(db.donorList.updateMany).not.toHaveBeenCalled();
  });

  test('completion requires an accepted donation and preserves reviewer metadata', async () => {
    const { service, db, row } = fixture();
    row.status = 'Accepted';
    row.statusValue = 1;
    await service.transition(3, 8, 9, 'Completed');
    expect(db.donorList.updateMany.mock.calls[0]?.[0]).toEqual({
      where: { id: 9, monasterySpaceId: 8, status: 'Accepted', statusValue: 1 },
      data: { status: 'Completed', statusValue: 3, completedAt: expect.any(Date) },
    });
  });

  for (const [current, target] of [
    ['Rejected', 'Accepted'],
    ['Completed', 'Rejected'],
    ['Pending', 'Completed'],
    ['Accepted', 'Accepted'],
  ] as const) {
    test(`rejects invalid transition ${current} -> ${target}`, async () => {
      const { service, db, row } = fixture();
      row.status = current;
      await expect(service.transition(3, 8, 9, target)).rejects.toMatchObject({ statusCode: 409 });
      expect(db.donorList.updateMany).not.toHaveBeenCalled();
    });
  }

  test('a competing review returns conflict rather than overwriting its result', async () => {
    const { service, db } = fixture();
    db.donorList.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.transition(3, 8, 9, 'Accepted')).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(db.donorList.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  test('propagates database failures', async () => {
    const { service, db } = fixture();
    db.donorList.create.mockRejectedValue(new Error('Database unavailable'));
    await expect(service.create(2, 8, input)).rejects.toThrow('Database unavailable');
  });
});

describe('donation request validation', () => {
  for (const body of [
    { ...input, donorId: 99 },
    { ...input, status: 'Accepted' },
    { ...input, reviewerId: 99 },
    { ...input, donationType: ' ' },
    { ...input, donationTypeValue: -1 },
    { ...input, amount: '-1' },
    { ...input, amount: '0' },
    { ...input, amount: '1.001' },
    { ...input, quantity: '10000000000000000' },
    { ...input, amount: 1.1 },
    { ...input, pickupTime: 'not a date' },
    { ...input, dropoffTime: '2026-11-01T00:00:00Z' },
  ]) {
    test(`rejects invalid input ${JSON.stringify(body)}`, () => {
      expect(donationInput.safeParse(body).success).toBe(false);
    });
  }
  test('defaults and bounds pagination', () => {
    expect(donationQuery.parse({})).toEqual({ page: 1, limit: 20 });
    expect(donationQuery.safeParse({ limit: 101 }).success).toBe(false);
    expect(donationQuery.safeParse({ page: 0 }).success).toBe(false);
  });
});

describe('donation HTTP routes', () => {
  function httpFixture() {
    const { service, db } = fixture();
    const app = express();
    app.use(express.json());
    // The production parent space router supplies JWT authentication.
    app.use((req, _res, next) => {
      req.user = { userId: 2, roleId: 2 };
      next();
    });
    app.use('/spaces/:spaceId/donations', createSpaceDonationRouter(service));
    app.use(globalErrorHandler);
    return { app, db };
  }

  test('submission validates, uses the authenticated identity and returns 201', async () => {
    const { app } = httpFixture();
    const response = await request(app).post('/spaces/8/donations').send(input);
    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      monasterySpaceId: 8,
      donorId: 2,
      status: 'Pending',
    });
  });

  test('invalid body/IDs return 400 before any write', async () => {
    const { app, db } = httpFixture();
    expect(
      (
        await request(app)
          .post('/spaces/8/donations')
          .send({ ...input, donorId: 99 })
      ).status
    ).toBe(400);
    expect((await request(app).post('/spaces/invalid/donations').send(input)).status).toBe(400);
    expect(db.donorList.create).not.toHaveBeenCalled();
  });

  test('list/detail/review/complete routes preserve scope and reject invalid review status', async () => {
    const { app } = httpFixture();
    expect((await request(app).get('/spaces/8/donations?page=1&limit=5')).status).toBe(200);
    expect((await request(app).get('/spaces/8/donations/9')).status).toBe(200);
    expect(
      (await request(app).patch('/spaces/8/donations/9/review').send({ status: 'Accepted' })).status
    ).toBe(200);
    expect(
      (await request(app).patch('/spaces/8/donations/9/review').send({ status: 'Completed' }))
        .status
    ).toBe(400);
    expect((await request(app).patch('/spaces/8/donations/9/complete').send({})).status).toBe(409);
  });

  test('permission errors are returned as 403', async () => {
    const { app, db } = httpFixture();
    db.rolePermission.count.mockResolvedValue(0);
    expect(
      (await request(app).patch('/spaces/8/donations/9/review').send({ status: 'Accepted' })).status
    ).toBe(403);
  });
});
