import type { PrismaClient } from 'prisma-client';
import type { z } from 'zod';
import { AppError } from '@/utils/AppError';
import { DONATION_STATUS, type DonationInput, type donationQuery } from './donation.schema';
import type { SpacePermission } from './space.permissions';

type DonationDatabase = Pick<
  PrismaClient,
  'monasteryMember' | 'rolePermission' | 'donorList' | '$transaction'
>;

export function createDonationService(db: DonationDatabase) {
  async function authorize(userId: number, spaceId: number, permission: SpacePermission) {
    const member = await db.monasteryMember.findFirst({
      where: {
        userId,
        monasterySpaceId: spaceId,
        user: { isDeleted: false },
        monasterySpace: { isDeleted: false },
      },
    });
    if (!member) throw new AppError('Active monastery membership required', 403);
    if (member.isOwner) return;
    const granted = await db.rolePermission.count({
      where: {
        roleId: member.role,
        role: { isDeleted: false },
        permission: { name: permission, isDeleted: false },
      },
    });
    if (!granted) throw new AppError(`Missing permission: ${permission}`, 403);
  }

  return {
    async create(userId: number, spaceId: number, input: DonationInput) {
      await authorize(userId, spaceId, 'Space.Donation.Create');
      return db.donorList.create({
        data: {
          monasterySpaceId: spaceId,
          donorId: userId,
          donorName: input.donorName,
          donationType: input.donationType,
          donationTypeValue: input.donationTypeValue,
          customDonationType: input.customDonationType,
          note: input.note,
          amount: input.amount,
          quantity: input.quantity,
          pickupTime: input.pickupTime ? new Date(input.pickupTime) : undefined,
          dropoffTime: input.dropoffTime ? new Date(input.dropoffTime) : undefined,
          status: 'Pending',
          statusValue: DONATION_STATUS.Pending,
        },
      });
    },

    async list(userId: number, spaceId: number, query: z.infer<typeof donationQuery>) {
      await authorize(userId, spaceId, 'Space.View');
      const where = {
        monasterySpaceId: spaceId,
        ...(query.status ? { status: query.status } : {}),
      };
      const [items, total] = await db.$transaction([
        db.donorList.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        db.donorList.count({ where }),
      ]);
      return { items, total, page: query.page, limit: query.limit };
    },

    async get(userId: number, spaceId: number, donationId: number) {
      await authorize(userId, spaceId, 'Space.View');
      const donation = await db.donorList.findFirst({
        where: { id: donationId, monasterySpaceId: spaceId },
      });
      if (!donation) throw new AppError('Donation not found in this space', 404);
      return donation;
    },

    async transition(
      userId: number,
      spaceId: number,
      donationId: number,
      status: 'Accepted' | 'Rejected' | 'Completed'
    ) {
      await authorize(userId, spaceId, 'Space.Donation.Review');
      return db.$transaction(async (tx) => {
        const donation = await tx.donorList.findFirst({
          where: { id: donationId, monasterySpaceId: spaceId },
        });
        if (!donation) throw new AppError('Donation not found in this space', 404);
        const expected = status === 'Completed' ? 'Accepted' : 'Pending';
        if (donation.status !== expected)
          throw new AppError(`Only ${expected} donations can become ${status}`, 409);
        const now = new Date();
        const result = await tx.donorList.updateMany({
          where: {
            id: donationId,
            monasterySpaceId: spaceId,
            status: expected,
            statusValue: DONATION_STATUS[expected],
          },
          data: {
            status,
            statusValue: DONATION_STATUS[status],
            ...(status === 'Completed'
              ? { completedAt: now }
              : { reviewerId: userId, reviewedAt: now }),
          },
        });
        if (result.count !== 1) throw new AppError('Donation changed; reload before retrying', 409);
        return tx.donorList.findUniqueOrThrow({ where: { id: donationId } });
      });
    },
  };
}
