import { z } from 'zod';
import { PaginationQuerySchema } from '@/helper/paginationSchema';

export const createSpaceSchema = z.object({
  body: z.object({
    monasteryName: z
      .string({ required_error: 'Monastery name is required.' })
      .trim()
      .min(1, 'Monastery name is required.')
      .max(255),
    description: z.string().trim().max(1000).optional(),
    address: z.string().trim().max(500).optional(),
  }),
});

export const updateSpaceSchema = z.object({
  params: z.object({
    id: z.coerce.number().int().positive('Invalid space ID'),
  }),
  body: z.object({
    monasteryName: z.string().trim().max(255).optional(),
    description: z.string().trim().max(1000).optional(),
    address: z.string().trim().max(500).optional(),
  }),
});

export const spaceIdParamSchema = z.object({
  params: z.object({
    id: z.coerce.number().int().positive('Invalid space ID'),
  }),
});

export const spacePaginationSchema = z.object({
  query: PaginationQuerySchema.extend({
    search: z.string().trim().optional(),
  }),
});

export const inviteMemberSchema = z.object({
  params: z.object({
    id: z.coerce.number().int().positive('Invalid space ID'),
  }),
  body: z
    .object({
      roleId: z.coerce.number().int().positive('Valid roleId is required'),
      userId: z.coerce.number().int().positive().optional(),
      phoneNumber: z.string().trim().optional(),
    })
    .refine(
      (data) => data.userId !== undefined || (data.phoneNumber && data.phoneNumber.length > 0),
      {
        message: 'Either userId or phoneNumber must be provided',
        path: ['userId'],
      }
    ),
});

export const respondInvitationSchema = z.object({
  params: z.object({
    invitationId: z.coerce.number().int().positive('Invalid invitation ID'),
  }),
  body: z.object({
    status: z.coerce
      .number()
      .int()
      .refine((val) => val === 1 || val === 2, {
        message: 'Invitation response must be Accept or Reject.',
      }),
  }),
});

export const updateMemberRoleSchema = z.object({
  params: z.object({
    id: z.coerce.number().int().positive('Invalid space ID'),
    memberUserId: z.coerce.number().int().positive('Invalid member user ID'),
  }),
  body: z.object({
    roleId: z.coerce.number().int().positive('Valid roleId is required'),
  }),
});

export const removeMemberSchema = z.object({
  params: z.object({
    id: z.coerce.number().int().positive('Invalid space ID'),
    memberUserId: z.coerce.number().int().positive('Invalid member user ID'),
  }),
});

export type CreateSpaceInput = z.infer<typeof createSpaceSchema>['body'];
export type UpdateSpaceInput = z.infer<typeof updateSpaceSchema>['body'];
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>['body'];
export type RespondInvitationInput = z.infer<typeof respondInvitationSchema>['body'];
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>['body'];
