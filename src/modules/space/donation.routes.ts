import { type Request, type RequestHandler, Router } from 'express';
import { z } from 'zod';
import { AppError } from '@/utils/AppError';
import { successResponse } from '@/utils/response';
import {
  type DonationPermission,
  donationParams,
  donationQuery,
  donationReview,
  donationSchedule,
  monthlyQuery,
  requestBatchInput,
  requestDonationInput,
  requestManualInput,
  requestManualRecurringInput,
  requestRecurringInput,
  spaceDonationParams,
} from './donation.schema';
import type { createDonationService } from './donation.service';

type Service = ReturnType<typeof createDonationService>;
export function createDonationRouter(service: Service, scoped = false) {
  const router = Router({ mergeParams: true });
  const scope = (req: Request) =>
    scoped ? spaceDonationParams.parse(req.params).spaceId : undefined;
  function body(req: Request) {
    if (!scoped) return req.body;
    const spaceId = scope(req);
    if (req.body?.monasterySpaceId !== undefined && Number(req.body.monasterySpaceId) !== spaceId)
      throw new AppError('Body monasterySpaceId must match the URL', 400);
    return { ...req.body, monasterySpaceId: spaceId };
  }
  function query(req: Request) {
    if (!scoped) return req.query;
    const spaceId = scope(req);
    if (req.query.monasterySpaceId !== undefined && Number(req.query.monasterySpaceId) !== spaceId)
      throw new AppError('Query monasterySpaceId must match the URL', 400);
    return { ...req.query, monasterySpaceId: spaceId };
  }
  const handle =
    (
      permission: DonationPermission,
      action: (req: Request) => Promise<unknown>,
      message: string,
      code = 200
    ): RequestHandler =>
    async (req, res, next) => {
      try {
        await service.authorizeEndpoint(req.user.userId, permission, scope(req));
        return successResponse(res, await action(req), message, code);
      } catch (error) {
        next(error);
      }
    };
  const submit = handle(
    'Donation.Create',
    async (req) => {
      const { monasterySpaceId, ...input } = requestDonationInput.parse(body(req));
      return service.request(req.user.userId, monasterySpaceId, input);
    },
    'Donation request submitted successfully',
    201
  );
  router.post('/request', submit);
  if (scoped) router.post('/', submit);
  router.post(
    '/manual',
    handle(
      'Donation.Create',
      async (req) => {
        const { monasterySpaceId, ...input } = requestManualInput.parse(body(req));
        return service.manual(req.user.userId, monasterySpaceId, input);
      },
      'Manual donation created successfully',
      201
    )
  );
  router.post(
    '/batch',
    handle(
      'Donation.Create',
      async (req) => {
        const { monasterySpaceId, donations } = requestBatchInput.parse(body(req));
        return service.batch(req.user.userId, monasterySpaceId, donations);
      },
      'Batch donations created successfully',
      201
    )
  );
  router.post(
    '/recurring/request',
    handle(
      'Donation.Create',
      async (req) => {
        const { monasterySpaceId, ...input } = requestRecurringInput.parse(body(req));
        return service.recurring(req.user.userId, monasterySpaceId, input);
      },
      'Recurring donation series requested successfully',
      201
    )
  );
  router.post(
    '/recurring/manual',
    handle(
      'Donation.Create',
      async (req) => {
        const { monasterySpaceId, ...input } = requestManualRecurringInput.parse(body(req));
        return service.recurring(req.user.userId, monasterySpaceId, input, true);
      },
      'Recurring donation series created successfully',
      201
    )
  );
  router.get('/', async (req, res, next) => {
    try {
      await service.authorizeEndpoint(req.user.userId, 'Donation.View', scope(req));
      const result = await service.list(req.user.userId, donationQuery.parse(query(req)));
      return res.json({
        success: true,
        message: 'Donations retrieved successfully',
        data: result.items,
        pagination: result.pagination,
      });
    } catch (error) {
      next(error);
    }
  });
  router.get('/calendar', (req, res, next) => {
    // Keep the pre-existing Myanmar date-range calendar contract available.
    if (!scoped && req.query.year === undefined && req.query.month === undefined)
      return next('router');
    return handle(
      'Donation.View',
      async (request) => service.monthly(request.user.userId, monthlyQuery.parse(query(request))),
      'Monthly calendar summary retrieved successfully'
    )(req, res, next);
  });
  router.get(
    '/:donationId',
    handle(
      'Donation.View',
      async (req) =>
        service.get(req.user.userId, donationParams.parse(req.params).donationId, scope(req)),
      'Donation retrieved successfully'
    )
  );
  for (const action of ['review', 'schedule', 'complete', 'cancel'] as const) {
    const permission = {
      review: 'Donation.Review',
      schedule: 'Donation.Schedule',
      complete: 'Donation.Schedule',
      cancel: 'Donation.Cancel',
    } as const;
    const handler = handle(
      permission[action],
      async (req) => {
        const input =
          action === 'review'
            ? donationReview.parse(req.body)
            : action === 'schedule'
              ? donationSchedule.parse(req.body)
              : z
                  .object({})
                  .strict()
                  .parse(req.body ?? {});
        return service.change(
          req.user.userId,
          donationParams.parse(req.params).donationId,
          action,
          input,
          scope(req)
        );
      },
      `Donation ${action} successful`
    );
    router.put(`/:donationId/${action}`, handler);
    if (scoped) router.patch(`/:donationId/${action}`, handler);
  }
  router.delete(
    '/:donationId',
    handle(
      'Donation.Delete',
      async (req) =>
        service.change(
          req.user.userId,
          donationParams.parse(req.params).donationId,
          'delete',
          {},
          scope(req)
        ),
      'Donation deleted successfully'
    )
  );
  return router;
}
export const createSpaceDonationRouter = (service: Service) => createDonationRouter(service, true);
