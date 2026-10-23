import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authMiddleware } from '@/middlewares/authMiddleWare';
import { validator } from '@/middlewares/validator';
import { AppError } from '@/utils/AppError';
import { successResponse } from '@/utils/response';
import { DAY, dateStart, donationDate, localDate } from './calendar.time';

export const calendarQuery = z
  .object({
    monasterySpaceId: z.coerce.number().int().positive(),
    fromDate: z.iso.date(),
    toDate: z.iso.date(),
  })
  .refine(
    (q) =>
      q.fromDate <= q.toDate &&
      dateStart(q.toDate).getTime() - dateStart(q.fromDate).getTime() <= 366 * DAY,
    'Date range must be ordered and at most 366 days'
  );
export const donationCalendarRouter = Router();
donationCalendarRouter.use(authMiddleware);
donationCalendarRouter.get(
  '/calendar',
  validator(z.object({ query: calendarQuery })),
  async (req, res, next) => {
    try {
      const q = calendarQuery.parse(req.query);
      const member = await prisma.monasteryMember.findFirst({
        where: {
          userId: req.user.userId,
          monasterySpaceId: q.monasterySpaceId,
          user: { isDeleted: false },
          monasterySpace: { isDeleted: false },
        },
      });
      if (!member) throw new AppError('Monastery membership required', 403);
      const range = {
        gte: dateStart(q.fromDate),
        lt: new Date(dateStart(q.toDate).getTime() + DAY),
      };
      const rows = await prisma.donorList.findMany({
        where: {
          monasterySpaceId: q.monasterySpaceId,
          OR: [
            { pickupTime: range },
            { pickupTime: null, dropoffTime: range },
            { pickupTime: null, dropoffTime: null, createdAt: range },
          ],
        },
        include: { donor: { select: { name: true } } },
        orderBy: { id: 'asc' },
      });
      const groups = new Map<string, unknown[]>();
      for (const row of rows) {
        const date = localDate(donationDate(row));
        const items = groups.get(date) ?? [];
        items.push({
          id: row.id,
          donorName: row.donorName ?? row.donor?.name ?? null,
          donationType: row.donationType,
          status: row.status,
          pickupTime: row.pickupTime,
          dropoffTime: row.dropoffTime,
        });
        groups.set(date, items);
      }
      return successResponse(
        res,
        [...groups]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, donations]) => ({ date, donations })),
        'Donation calendar'
      );
    } catch (error) {
      next(error);
    }
  }
);
