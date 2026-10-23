import { Router } from 'express';
import { z } from 'zod';
import { validator } from '@/middlewares/validator';
import { successResponse } from '@/utils/response';
import {
  donationInput,
  donationParams,
  donationQuery,
  donationReview,
  spaceDonationParams,
} from './donation.schema';
import type { createDonationService } from './donation.service';

export function createSpaceDonationRouter(service: ReturnType<typeof createDonationService>) {
  const router = Router({ mergeParams: true });
  router.post(
    '/',
    validator(z.object({ params: spaceDonationParams, body: donationInput })),
    async (req, res, next) => {
      try {
        const { spaceId } = spaceDonationParams.parse(req.params);
        const donation = await service.create(
          req.user.userId,
          spaceId,
          donationInput.parse(req.body)
        );
        return successResponse(res, donation, 'Donation submitted for review', 201);
      } catch (error) {
        next(error);
      }
    }
  );
  router.get(
    '/',
    validator(z.object({ params: spaceDonationParams, query: donationQuery })),
    async (req, res, next) => {
      try {
        const { spaceId } = spaceDonationParams.parse(req.params);
        return successResponse(
          res,
          await service.list(req.user.userId, spaceId, donationQuery.parse(req.query)),
          'Donations retrieved'
        );
      } catch (error) {
        next(error);
      }
    }
  );
  router.get(
    '/:donationId',
    validator(z.object({ params: donationParams })),
    async (req, res, next) => {
      try {
        const { spaceId, donationId } = donationParams.parse(req.params);
        return successResponse(
          res,
          await service.get(req.user.userId, spaceId, donationId),
          'Donation retrieved'
        );
      } catch (error) {
        next(error);
      }
    }
  );
  router.patch(
    '/:donationId/review',
    validator(z.object({ params: donationParams, body: donationReview })),
    async (req, res, next) => {
      try {
        const { spaceId, donationId } = donationParams.parse(req.params);
        const { status } = donationReview.parse(req.body);
        return successResponse(
          res,
          await service.transition(req.user.userId, spaceId, donationId, status),
          'Donation reviewed'
        );
      } catch (error) {
        next(error);
      }
    }
  );
  router.patch(
    '/:donationId/complete',
    validator(z.object({ params: donationParams, body: z.object({}).strict() })),
    async (req, res, next) => {
      try {
        const { spaceId, donationId } = donationParams.parse(req.params);
        return successResponse(
          res,
          await service.transition(req.user.userId, spaceId, donationId, 'Completed'),
          'Donation completed'
        );
      } catch (error) {
        next(error);
      }
    }
  );
  return router;
}
