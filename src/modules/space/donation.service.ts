import type { DonorList, Prisma, PrismaClient } from 'prisma-client';
import type { z } from 'zod';
import { AppError } from '@/utils/AppError';
import {
  DONATION_STATUS,
  DONATION_TYPE,
  type DonationInput,
  type DonationPermission,
  type donationQuery,
  type ManualDonationInput,
  type ManualRecurringInput,
  type monthlyQuery,
  type RecurringInput,
} from './donation.schema';

export const DONATION_NOTIFICATION_TYPE = 5; // Node already reserves 1-4 for invitations/reminders.
type Database = Pick<
  PrismaClient,
  '$transaction' | 'user' | 'monasterySpace' | 'monasteryMember' | 'rolePermission' | 'donorList'
> & {
  spaceRolePermission?: PrismaClient['spaceRolePermission'];
};
type TxWithSpace = {
  spaceRolePermission?: {
    count: (args: unknown) => Promise<number>;
    findMany: (args: unknown) => Promise<{ spaceRoleId: number }[]>;
  };
};
type Tx = Prisma.TransactionClient;
type Push = { token: string; message: string; donationId: number };
type Delivery = {
  sendPush?: (token: string, message: string, data: Record<string, string>) => Promise<void>;
  onPushError?: (error: unknown) => void;
};
type Change = 'review' | 'schedule' | 'complete' | 'cancel' | 'delete';
type ChangeInput = {
  status?: number;
  note?: string | null;
  pickupTime?: string | null;
  dropoffTime?: string | null;
};
const asDate = (value?: string | null) => (value ? new Date(value) : null);
function enumName(values: Record<string, number>, value: number) {
  const name = Object.keys(values).find((key) => values[key] === value);
  if (name === undefined) throw new AppError('Invalid donation enum value', 400);
  return name;
}
const statusName = (value: number) => enumName(DONATION_STATUS, value);
const typeName = (value: number) => enumName(DONATION_TYPE, value);

export function mapDonation(row: DonorList) {
  return {
    id: row.id,
    monasterySpaceId: row.monasterySpaceId,
    donorId: row.donorId,
    donorName: row.donorName,
    donationType: row.donationTypeValue,
    customDonationType: row.customDonationType,
    note: row.note,
    amount: row.amount?.toString() ?? null,
    quantity: row.quantity?.toString() ?? null,
    status: row.statusValue,
    reviewerId: row.reviewerId,
    createdAt: row.createdAt,
    reviewedAt: row.reviewedAt,
    pickupTime: row.pickupTime,
    dropoffTime: row.dropoffTime,
    completedAt: row.completedAt,
  };
}

export function recurringDates(input: RecurringInput) {
  const start = new Date(input.startDate);
  const time = (date: Date, value?: string | null) => {
    if (!value) return null;
    const [h = 0, m = 0, s = 0] = value.split(':').map(Number);
    return new Date(date.getTime() + ((h * 60 + m) * 60 + s) * 1000);
  };
  return Array.from({ length: input.monthsCount }, (_, i) => {
    const month = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
    const lastDay = new Date(
      Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)
    ).getUTCDate();
    month.setUTCDate(Math.min(input.dayOfMonth, lastDay));
    return {
      pickupTime: time(month, input.pickupTimeOfDay),
      dropoffTime: time(month, input.dropoffTimeOfDay),
    };
  });
}

export function createDonationService(db: Database, delivery: Delivery = {}) {
  async function actor(tx: Database | Tx, userId: number) {
    const user = await tx.user.findFirst({
      where: { id: userId, isDeleted: false, role: { isDeleted: false } },
    });
    if (!user) throw new AppError('Active user not found', 403);
    return user;
  }
  async function activeSpace(tx: Database | Tx, spaceId: number) {
    if (!(await tx.monasterySpace.findFirst({ where: { id: spaceId, isDeleted: false } })))
      throw new AppError('Monastery not found', 404);
  }
  async function member(tx: Database | Tx, userId: number, spaceId: number) {
    return tx.monasteryMember.findFirst({
      where: {
        userId,
        monasterySpaceId: spaceId,
        user: { isDeleted: false },
        monasterySpace: { isDeleted: false },
      },
    });
  }
  const memberRoleId = (m: unknown): number =>
    (m as { spaceRoleId?: number; role?: number }).spaceRoleId ??
    (m as { spaceRoleId?: number; role?: number }).role ??
    0;

  async function hasPermission(tx: Database | Tx, roleId: number, permission: DonationPermission) {
    const hasRolePerm =
      (await tx.rolePermission.count({
        where: {
          roleId,
          role: { isDeleted: false },
          permission: { isDeleted: false, name: { in: [permission, `Space.${permission}`] } },
        },
      })) > 0;
    if (hasRolePerm) return true;

    const txWithSpace = tx as unknown as TxWithSpace;
    if (typeof txWithSpace.spaceRolePermission?.count === 'function') {
      const hasSpacePerm =
        (await txWithSpace.spaceRolePermission.count({
          where: {
            spaceRoleId: roleId,
            isDeleted: false,
            spaceRole: { isDeleted: false },
            spacePermission: {
              isDeleted: false,
              name: { in: [permission, `Space.${permission}`] },
            },
          },
        })) > 0;
      if (hasSpacePerm) return true;
    }

    return false;
  }
  async function manage(
    tx: Database | Tx,
    userId: number,
    spaceId: number,
    permission: DonationPermission
  ) {
    const membership = await member(tx, userId, spaceId);
    if (
      !membership ||
      (!membership.isOwner && !(await hasPermission(tx, memberRoleId(membership), permission)))
    )
      throw new AppError(`Missing space permission: ${permission}`, 403);
  }
  async function requestAccess(tx: Tx, userId: number, spaceId: number) {
    const user = await actor(tx, userId);
    await activeSpace(tx, spaceId);
    if (!(await hasPermission(tx, user.roleId, 'Donation.Create')))
      await manage(tx, userId, spaceId, 'Donation.Create');
    return user;
  }
  async function notify(
    tx: Tx,
    pushes: Push[],
    userId: number | null,
    message: string,
    donationId: number
  ) {
    if (userId === null) return;
    const user = await tx.user.findFirst({ where: { id: userId, isDeleted: false } });
    if (!user) return;
    await tx.notification.create({ data: { userId, type: DONATION_NOTIFICATION_TYPE, message } });
    if (user.fcmToken) pushes.push({ token: user.fcmToken, message, donationId });
  }
  async function notifyManagers(
    tx: Tx,
    pushes: Push[],
    spaceId: number,
    message: string,
    donationId: number
  ) {
    const members = await tx.monasteryMember.findMany({
      where: {
        monasterySpaceId: spaceId,
        user: { isDeleted: false },
        monasterySpace: { isDeleted: false },
      },
    });
    const memberRoleIds = members.map(memberRoleId);
    const reviewers = await tx.rolePermission.findMany({
      where: {
        roleId: { in: memberRoleIds },
        role: { isDeleted: false },
        permission: {
          isDeleted: false,
          name: { in: ['Donation.Review', 'Space.Donation.Review'] },
        },
      },
      select: { roleId: true },
    });
    const matchedRoleIds = reviewers.map((r) => r.roleId);
    const txWithSpace = tx as unknown as TxWithSpace;
    if (typeof txWithSpace.spaceRolePermission?.findMany === 'function') {
      const spaceReviewers = await txWithSpace.spaceRolePermission.findMany({
        where: {
          spaceRoleId: { in: memberRoleIds },
          isDeleted: false,
          spaceRole: { isDeleted: false },
          spacePermission: {
            isDeleted: false,
            name: { in: ['Donation.Review', 'Space.Donation.Review'] },
          },
        },
        select: { spaceRoleId: true },
      });
      matchedRoleIds.push(...spaceReviewers.map((r: { spaceRoleId: number }) => r.spaceRoleId));
    }
    const roles = new Set(matchedRoleIds);
    const users = new Set(
      members.filter((m) => m.isOwner || roles.has(memberRoleId(m))).map((m) => m.userId)
    );
    for (const userId of users) await notify(tx, pushes, userId, message, donationId);
  }
  async function write<T>(action: (tx: Tx, pushes: Push[]) => Promise<T>) {
    const pushes: Push[] = [];
    const result = await db.$transaction((tx) => action(tx, pushes), { timeout: 30000 });
    for (const push of pushes) {
      try {
        await delivery.sendPush?.(push.token, push.message, {
          donationId: String(push.donationId),
          type: 'Donation',
        });
      } catch (error) {
        delivery.onPushError?.(error);
      }
    }
    return result;
  }
  function data(
    spaceId: number,
    input: DonationInput,
    donor: { id: number | null; name: string | null },
    userId?: number
  ): Prisma.DonorListUncheckedCreateInput {
    const manual = userId !== undefined;
    const status = manual
      ? input.pickupTime || input.dropoffTime
        ? 'Scheduled'
        : 'Accepted'
      : 'PendingReview';
    return {
      monasterySpaceId: spaceId,
      donorId: donor.id,
      donorName: donor.name,
      donationType: typeName(input.donationType),
      donationTypeValue: input.donationType,
      customDonationType: input.customDonationType,
      note: input.note,
      amount: input.amount,
      quantity: input.quantity,
      pickupTime: asDate(input.pickupTime),
      dropoffTime: asDate(input.dropoffTime),
      status,
      statusValue: DONATION_STATUS[status],
      ...(manual ? { reviewerId: userId, reviewedAt: new Date() } : {}),
    };
  }
  async function manualDonor(tx: Tx, input: Pick<ManualDonationInput, 'donorId' | 'donorName'>) {
    if (input.donorId != null) {
      const donor = await tx.user.findFirst({ where: { id: input.donorId, isDeleted: false } });
      if (!donor) throw new AppError('Donor user not found', 404);
      return { id: donor.id, name: donor.name };
    }
    if (!input.donorName?.trim())
      throw new AppError('Donor name is required without a donor account', 400);
    return { id: null, name: input.donorName.trim() };
  }
  async function visibleScope(
    userId: number,
    spaceId?: number,
    donorId?: number
  ): Promise<Prisma.DonorListWhereInput> {
    const user = await actor(db, userId);
    if (spaceId !== undefined) {
      if (!(await member(db, userId, spaceId)))
        throw new AppError('Monastery membership required', 403);
      return { monasterySpaceId: spaceId, ...(donorId !== undefined ? { donorId } : {}) };
    }
    if (donorId !== undefined && donorId !== userId)
      throw new AppError('Cannot view another donor history', 403);
    if (!(await hasPermission(db, user.roleId, 'Donation.View')))
      throw new AppError('Missing permission: Donation.View', 403);
    return { donorId: userId, monasterySpace: { isDeleted: false } };
  }

  return {
    // Mirrors the C# controller's HasPermission attributes. The separate service
    // checks below still enforce donor ownership and per-space membership.
    async authorizeEndpoint(userId: number, permission: DonationPermission, spaceId?: number) {
      const user = await actor(db, userId);
      if (await hasPermission(db, user.roleId, permission)) return;
      if (spaceId !== undefined) return manage(db, userId, spaceId, permission);
      throw new AppError(`Missing permission: ${permission}`, 403);
    },
    async request(userId: number, spaceId: number, input: DonationInput) {
      return write(async (tx, pushes) => {
        const donor = await requestAccess(tx, userId, spaceId);
        const row = await tx.donorList.create({ data: data(spaceId, input, donor) });
        await notifyManagers(
          tx,
          pushes,
          spaceId,
          'A new donation request is waiting for review.',
          row.id
        );
        return mapDonation(row);
      });
    },
    async manual(userId: number, spaceId: number, input: ManualDonationInput) {
      return write(async (tx, pushes) => {
        await actor(tx, userId);
        await manage(tx, userId, spaceId, 'Donation.Review');
        const donor = await manualDonor(tx, input);
        const row = await tx.donorList.create({ data: data(spaceId, input, donor, userId) });
        await notify(
          tx,
          pushes,
          donor.id,
          'Your donation has been recorded by the monastery.',
          row.id
        );
        return mapDonation(row);
      });
    },
    async batch(userId: number, spaceId: number, inputs: ManualDonationInput[]) {
      if (!inputs.length || inputs.length > 50)
        throw new AppError('Batch size must be between 1 and 50', 400);
      return write(async (tx, pushes) => {
        await actor(tx, userId);
        await manage(tx, userId, spaceId, 'Donation.Review');
        // Resolve every donor before inserting; the transaction also prevents partial batches.
        const donors = await Promise.all(inputs.map((input) => manualDonor(tx, input)));
        const rows: DonorList[] = [];
        for (const [i, input] of inputs.entries()) {
          const donor = donors[i];
          const row = await tx.donorList.create({ data: data(spaceId, input, donor, userId) });
          await notify(
            tx,
            pushes,
            donor.id,
            'Your donation has been recorded by the monastery.',
            row.id
          );
          rows.push(row);
        }
        return rows.map(mapDonation);
      });
    },
    async recurring(
      userId: number,
      spaceId: number,
      input: RecurringInput | ManualRecurringInput,
      manual = false
    ) {
      return write(async (tx, pushes) => {
        const user = manual ? await actor(tx, userId) : await requestAccess(tx, userId, spaceId);
        if (manual) await manage(tx, userId, spaceId, 'Donation.Review');
        const donor = manual ? await manualDonor(tx, input as ManualRecurringInput) : user;
        const series = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
        const rows: DonorList[] = [];
        for (const [i, dates] of recurringDates(input).entries()) {
          const note = `[Series: ${series}] (${i + 1}/${input.monthsCount})${input.note?.trim() ? ` - ${input.note}` : ''}`;
          const item = {
            ...input,
            note,
            pickupTime: dates.pickupTime?.toISOString(),
            dropoffTime: dates.dropoffTime?.toISOString(),
          };
          rows.push(
            await tx.donorList.create({
              data: data(spaceId, item, donor, manual ? userId : undefined),
            })
          );
        }
        if (manual)
          await notify(
            tx,
            pushes,
            donor.id,
            `A recurring donation series (${input.monthsCount} months) was recorded for you.`,
            rows[0].id
          );
        else
          await notifyManagers(
            tx,
            pushes,
            spaceId,
            `New recurring donation series (${input.monthsCount} months) submitted for review.`,
            rows[0].id
          );
        return rows.map(mapDonation);
      });
    },
    async list(userId: number, query: z.infer<typeof donationQuery>) {
      const scope = await visibleScope(userId, query.monasterySpaceId, query.donorId);
      const where = {
        ...scope,
        ...(query.status !== undefined ? { statusValue: query.status } : {}),
        ...(query.fromDate || query.toDate
          ? {
              createdAt: {
                ...(query.fromDate ? { gte: new Date(query.fromDate) } : {}),
                ...(query.toDate ? { lte: new Date(query.toDate) } : {}),
              },
            }
          : {}),
      };
      const [rows, totalCount] = await db.$transaction([
        db.donorList.findMany({
          where,
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          skip: (query.pageNumber - 1) * query.pageSize,
          take: query.pageSize,
        }),
        db.donorList.count({ where }),
      ]);
      const totalPages = Math.ceil(totalCount / query.pageSize);
      return {
        items: rows.map(mapDonation),
        pagination: {
          pageNumber: query.pageNumber,
          pageSize: query.pageSize,
          totalCount,
          totalPages,
          hasPreviousPage: query.pageNumber > 1,
          hasNextPage: query.pageNumber < totalPages,
        },
      };
    },
    async get(userId: number, donationId: number, spaceId?: number) {
      await actor(db, userId);
      const row = await db.donorList.findFirst({
        where: {
          id: donationId,
          ...(spaceId !== undefined ? { monasterySpaceId: spaceId } : {}),
          monasterySpace: { isDeleted: false },
        },
      });
      if (!row) throw new AppError('Donation not found', 404);
      if (row.donorId !== userId && !(await member(db, userId, row.monasterySpaceId)))
        throw new AppError('Cannot view this donation', 403);
      return mapDonation(row);
    },
    async change(
      userId: number,
      donationId: number,
      action: Change,
      input: ChangeInput = {},
      spaceId?: number
    ) {
      return write(async (tx, pushes) => {
        await actor(tx, userId);
        const row = await tx.donorList.findFirst({
          where: {
            id: donationId,
            ...(spaceId !== undefined ? { monasterySpaceId: spaceId } : {}),
            monasterySpace: { isDeleted: false },
          },
        });
        if (!row) throw new AppError('Donation not found', 404);
        if (action !== 'cancel' || row.donorId !== userId)
          await manage(
            tx,
            userId,
            row.monasterySpaceId,
            action === 'schedule' || action === 'complete' ? 'Donation.Schedule' : 'Donation.Review'
          );
        const current = row.statusValue;
        if (
          (action === 'review' && [5, 7].includes(current)) ||
          (action === 'schedule' && [5, 6, 7].includes(current)) ||
          (action === 'complete' && [6, 7].includes(current)) ||
          ((action === 'cancel' || action === 'delete') && current === 5)
        )
          throw new AppError('Donation status does not allow this action', 409);
        const guard = {
          id: row.id,
          monasterySpaceId: row.monasterySpaceId,
          statusValue: current,
          reviewedAt: row.reviewedAt,
          completedAt: row.completedAt,
          pickupTime: row.pickupTime,
          dropoffTime: row.dropoffTime,
        };
        if (action === 'delete') {
          if ((await tx.donorList.deleteMany({ where: guard })).count !== 1)
            throw new AppError('Donation changed; reload before retrying', 409);
          return true;
        }
        const now = new Date();
        let next: number;
        const update: Prisma.DonorListUncheckedUpdateManyInput = {};
        let message: string;
        if (action === 'review') {
          if (input.status !== 3 && input.status !== 6)
            throw new AppError('Review status must be Accepted or Rejected', 400);
          next = input.status;
          update.reviewerId = userId;
          update.reviewedAt = now;
          if (input.note?.trim()) update.note = input.note;
          message = `Your donation was ${statusName(next).toLowerCase()}.`;
        } else if (action === 'schedule') {
          if (!input.pickupTime && !input.dropoffTime)
            throw new AppError('Pickup time or dropoff time is required', 400);
          next = 4;
          update.pickupTime = asDate(input.pickupTime);
          update.dropoffTime = asDate(input.dropoffTime);
          message = 'Your donation pickup/dropoff schedule has been updated.';
        } else if (action === 'complete') {
          next = 5;
          update.completedAt = now;
          message = 'Your donation has been completed.';
        } else {
          next = 7;
          message = 'Your donation has been cancelled.';
        }
        update.status = statusName(next);
        update.statusValue = next;
        if ((await tx.donorList.updateMany({ where: guard, data: update })).count !== 1)
          throw new AppError('Donation changed; reload before retrying', 409);
        const updated = await tx.donorList.findUniqueOrThrow({ where: { id: row.id } });
        await notify(tx, pushes, row.donorId, message, row.id);
        return mapDonation(updated);
      });
    },
    async monthly(userId: number, query: z.infer<typeof monthlyQuery>) {
      const scope = await visibleScope(userId, query.monasterySpaceId);
      const start = new Date(Date.UTC(query.year, query.month - 1, 1));
      const end = new Date(Date.UTC(query.year, query.month, 1));
      const range = { gte: start, lt: end };
      const rows = await db.donorList.findMany({
        where: {
          ...scope,
          ...(query.status !== undefined ? { statusValue: query.status } : {}),
          OR: [{ pickupTime: range }, { pickupTime: null, createdAt: range }],
        },
      });
      const ordered = rows.sort(
        (a, b) =>
          (a.pickupTime ?? a.createdAt).getTime() - (b.pickupTime ?? b.createdAt).getTime() ||
          a.id - b.id
      );
      const days = new Map<number, ReturnType<typeof mapDonation>[]>();
      let cents = 0n;
      for (const row of ordered) {
        const [whole = '0', fraction = ''] = (row.amount?.toFixed(2) ?? '0.00').split('.');
        cents += BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
        const day = (row.pickupTime ?? row.createdAt).getUTCDate();
        days.set(day, [...(days.get(day) ?? []), mapDonation(row)]);
      }
      return {
        year: query.year,
        month: query.month,
        totalDonationsCount: rows.length,
        totalAmount: `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`,
        days: [...days].map(([day, donations]) => ({
          day,
          date: `${query.year}-${String(query.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
          donationsCount: donations.length,
          donations,
        })),
      };
    },
  };
}
