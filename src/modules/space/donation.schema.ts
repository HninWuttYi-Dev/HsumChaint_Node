import { z } from 'zod';

// HsumChaint.Shared/CommonEnum/{DonationStatus,DonationType}.cs
export const DONATION_STATUS = {
  Draft: 0,
  Submitted: 1,
  PendingReview: 2,
  Accepted: 3,
  Scheduled: 4,
  Completed: 5,
  Rejected: 6,
  Cancelled: 7,
} as const;
export const DONATION_TYPE = {
  Money: 0,
  Food: 1,
  Medicine: 2,
  Robe: 3,
  Supplies: 4,
  Other: 5,
} as const;
export const DONATION_PERMISSIONS = [
  'Donation.View',
  'Donation.Create',
  'Donation.Review',
  'Donation.Schedule',
  'Donation.Cancel',
  'Donation.Delete',
] as const;
export type DonationPermission = (typeof DONATION_PERMISSIONS)[number];
export type DonationStatus = keyof typeof DONATION_STATUS;

function enumCode<T extends Record<string, number>>(values: T) {
  const names = Object.keys(values) as [keyof T & string, ...(keyof T & string)[]];
  return z.union([
    z
      .number()
      .int()
      .min(0)
      .max(names.length - 1),
    z.enum(names).transform((name) => values[name]),
  ]);
}
export const statusCode = enumCode(DONATION_STATUS);
const queryStatus = z.preprocess(
  (value) => (typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value),
  statusCode
);
export const id = z.coerce.number().int().positive().max(2147483647);
const dateTime = z.iso.datetime({ offset: true });
const decimalString = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/, 'Use a non-negative Decimal(18,2) value');
const decimal = z.union([
  decimalString,
  z
    .number()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER / 100)
    .transform(String)
    .pipe(decimalString),
]);
const details = {
  donationType: enumCode(DONATION_TYPE),
  customDonationType: z.string().trim().min(1).max(255).nullable().optional(),
  note: z.string().max(1000).nullable().optional(),
  amount: decimal.nullable().optional(),
  quantity: decimal.nullable().optional(),
};
const timing = {
  pickupTime: dateTime.nullable().optional(),
  dropoffTime: dateTime.nullable().optional(),
};
const manualDonor = {
  donorId: id.nullable().optional(),
  donorName: z.string().trim().min(1).max(255).nullable().optional(),
};
const baseInput = z.object({ ...details, ...timing }).strict();
const validOther = (data: { donationType: number; customDonationType?: string | null }) =>
  data.donationType !== DONATION_TYPE.Other || Boolean(data.customDonationType?.trim());
export const donationInput = baseInput.refine(
  validOther,
  'Custom donation type is required for Other'
);
export const manualDonationInput = baseInput
  .extend(manualDonor)
  .refine(validOther, 'Custom donation type is required for Other')
  .refine(
    (data) => data.donorId != null || Boolean(data.donorName?.trim()),
    'Donor name is required without a donor account'
  );
export const requestDonationInput = donationInput.safeExtend({ monasterySpaceId: id });
export const requestManualInput = manualDonationInput.safeExtend({ monasterySpaceId: id });
export const batchInput = z
  .object({ donations: z.array(manualDonationInput).min(1).max(50) })
  .strict();
export const requestBatchInput = batchInput.extend({ monasterySpaceId: id });

const timeOfDay = z
  .string()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/, 'Use HH:mm or HH:mm:ss');
const recurringBase = z
  .object({
    ...details,
    note: z.string().max(900).nullable().optional(),
    startDate: z.union([z.iso.date(), dateTime]),
    dayOfMonth: z.number().int().min(1).max(31),
    monthsCount: z.number().int().min(1).max(24),
    pickupTimeOfDay: timeOfDay.nullable().optional(),
    dropoffTimeOfDay: timeOfDay.nullable().optional(),
  })
  .strict();
export const recurringInput = recurringBase.refine(
  validOther,
  'Custom donation type is required for Other'
);
export const manualRecurringInput = recurringBase
  .extend(manualDonor)
  .refine(validOther, 'Custom donation type is required for Other')
  .refine(
    (data) => data.donorId != null || Boolean(data.donorName?.trim()),
    'Donor name is required without a donor account'
  );
export const requestRecurringInput = recurringInput.safeExtend({ monasterySpaceId: id });
export const requestManualRecurringInput = manualRecurringInput.safeExtend({
  monasterySpaceId: id,
});
export const donationParams = z.object({ donationId: id });
export const spaceDonationParams = z.object({ spaceId: id });
export const donationQuery = z
  .object({
    monasterySpaceId: id.optional(),
    donorId: id.optional(),
    pageNumber: z.coerce.number().int().min(1).max(1000000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(10),
    status: queryStatus.optional(),
    fromDate: dateTime.optional(),
    toDate: dateTime.optional(),
  })
  .refine(
    (data) =>
      !data.fromDate || !data.toDate || Date.parse(data.fromDate) <= Date.parse(data.toDate),
    'Date range must be ordered'
  );
export const donationReview = z
  .object({
    status: statusCode.refine(
      (value) => value === 3 || value === 6,
      'Review status must be Accepted or Rejected'
    ),
    note: z.string().max(1000).nullable().optional(),
  })
  .strict();
export const donationSchedule = z
  .object(timing)
  .strict()
  .refine(
    (data) => data.pickupTime != null || data.dropoffTime != null,
    'Pickup time or dropoff time is required'
  );
export const monthlyQuery = z.object({
  monasterySpaceId: id.optional(),
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  status: queryStatus.optional(),
});
export type DonationInput = z.infer<typeof donationInput>;
export type ManualDonationInput = z.infer<typeof manualDonationInput>;
export type RecurringInput = z.infer<typeof recurringInput>;
export type ManualRecurringInput = z.infer<typeof manualRecurringInput>;
