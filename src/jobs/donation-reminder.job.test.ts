import { expect, mock, test } from 'bun:test';
import pino from 'pino';

const notifications: { userId: number; type: number; message: string; createdAt: Date }[] = [];
const push = mock(async () => {});
const donationQuery = mock(async (_query: unknown) => [
  {
    id: 42,
    donorId: 8,
    pickupTime: new Date('2026-10-24T03:30:00Z'),
    dropoffTime: null,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    monasterySpace: { members: [{ userId: 9 }, { userId: 8 }] },
  },
]);
const tx = {
  user: { findFirst: async () => ({ fcmToken: 'test-token' }) },
  notification: {
    findFirst: async ({
      where,
    }: {
      where: { userId: number; type: number; message: string; createdAt: { gte: Date; lt: Date } };
    }) =>
      notifications.find(
        (n) =>
          n.userId === where.userId &&
          n.type === where.type &&
          n.message === where.message &&
          n.createdAt >= where.createdAt.gte &&
          n.createdAt < where.createdAt.lt
      ) ?? null,
    create: async ({ data }: { data: (typeof notifications)[number] }) => {
      notifications.push(data);
      return data;
    },
  },
};
mock.module('@/lib/prisma', () => ({
  prisma: {
    $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    userSetting: {
      findMany: async () => [
        {
          userId: 7,
          pickupNotificationTime: new Date('1970-01-01T03:00:00Z'),
          dropoffNotificationTime: new Date('1970-01-01T09:00:00Z'),
        },
      ],
    },
    donorList: { findMany: donationQuery },
  },
}));
mock.module('@/lib/firebase', () => ({ sendPush: push }));
mock.module('@/utils/logger', () => ({ logger: pino({ enabled: false }) }));

const { runReminders } = await import('./donation-reminder.job');

test('routine due times, advance recipients, deduplication, and push failure persistence', async () => {
  const now = new Date('2026-10-22T03:30:00Z');
  await runReminders(now);
  expect(notifications.map((n) => [n.userId, n.type])).toEqual([
    [7, 3],
    [8, 2],
    [9, 2],
  ]);
  expect(notifications[1]?.message).toContain('in 2 day(s)');
  expect(push).toHaveBeenCalledTimes(3);
  await runReminders(now);
  expect(notifications).toHaveLength(3);
  expect(push).toHaveBeenCalledTimes(3);
  expect(donationQuery.mock.calls[0]?.[0]).toMatchObject({
    where: { status: { in: ['Accepted', 'Scheduled'] } },
  });
  push.mockImplementation(async () => {
    throw new Error('FCM unavailable');
  });
  await runReminders(new Date('2026-10-22T10:00:00Z'));
  expect(notifications.filter((n) => n.type === 4)).toHaveLength(1);
  await runReminders(new Date('2026-10-22T10:01:00Z'));
  expect(notifications).toHaveLength(4);
});
