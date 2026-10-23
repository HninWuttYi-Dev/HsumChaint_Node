import { z } from 'zod';

// Keep the string status in sync with the reminder job's Accepted filter.
export const DONATION_STATUS = { Pending: 0, Accepted: 1, Rejected: 2, Completed: 3 } as const;

const decimal = z
  .string()
  .regex(
    /^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/,
    'Use a positive decimal string with at most 2 decimal places'
  )
  .refine((value) => Number(value) > 0, 'Must be greater than zero');
export const donationInput = z
  .object({
    donationType: z.string().trim().min(1).max(100),
    donationTypeValue: z.number().int().positive().max(2147483647),
    customDonationType: z.string().trim().min(1).max(255).optional(),
    donorName: z.string().trim().min(1).max(255).optional(),
    note: z.string().trim().max(1000).optional(),
    amount: decimal.optional(),
    quantity: decimal.optional(),
    pickupTime: z.iso.datetime({ offset: true }).optional(),
    dropoffTime: z.iso.datetime({ offset: true }).optional(),
  })
  .strict()
  .refine(
    (data) =>
      !data.pickupTime ||
      !data.dropoffTime ||
      Date.parse(data.pickupTime) <= Date.parse(data.dropoffTime),
    'Dropoff must be at or after pickup'
  );

export const spaceDonationParams = z.object({ spaceId: z.coerce.number().int().positive() });
export const donationParams = spaceDonationParams.extend({
  donationId: z.coerce.number().int().positive(),
});
export const donationQuery = z.object({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['Pending', 'Accepted', 'Rejected', 'Completed']).optional(),
});
export const donationReview = z.object({ status: z.enum(['Accepted', 'Rejected']) }).strict();
export type DonationInput = z.infer<typeof donationInput>;
