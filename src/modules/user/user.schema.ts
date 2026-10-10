import { z } from 'zod';
import { PaginationQuerySchema } from '@/helper/paginationSchema';
import { passwordSchema, phoneSchema } from '../auth/auth.schema';

export const UserSchema = z.object({
  id: z.number().describe('The user ID'),
  phone: z.string().describe('The user phone number'),
  name: z.string().describe('The user name'),
  email: z.string().email().nullable().describe('The user email address'),
  roleId: z.number().describe('The user role ID'),
  createdAt: z.date().describe('The user creation date'),
});

export const CreateUserSchema = z.object({
  phone: z.string().describe('The user phone number'),
  name: z.string().describe('The user name'),
  email: z.string().email().optional().describe('The user email address'),
  password: z.string().describe('The user password'),
  roleId: z.number().describe('The user role ID'),
});

const normalizePhoneSearch = z
  .string()
  .trim()
  .transform((value) => {
    // remove non-digits
    const cleaned = value.replace(/\D/g, '');
    // normalize Myanmar formats
    if (cleaned.startsWith('959')) return `09${cleaned.slice(3)}`;
    if (cleaned.startsWith('09')) return cleaned;
    return cleaned;
  })
  .optional();
export const getAllUsersSchema = z.object({
  query: PaginationQuerySchema.extend({
    name: z.string().trim().optional(),
    email: z.string().trim().toLowerCase().optional(),
    phone: normalizePhoneSearch,
    contactPhone: normalizePhoneSearch,
    roleId: z.coerce.number().int().positive().optional(),
    monasteryName: z.string().optional(),
    monasteryAddress: z.string().optional(),
  }),
});
export const idParamSchema = z.object({
  params: z.object({
    id: z
      .string()
      .regex(/^\d+$/, 'ID must be a number')
      .transform(Number)
      .refine((val) => !Number.isNaN(val), 'ID must be a valid number'),
  }),
});
export const updateUserSchema = z.object({
  params: idParamSchema.shape.params,
  body: z
    .object({
      name: z
        .string('name is required')
        .trim()
        .min(3, 'Name must be at least 3 characters')
        .optional(),
      phone: phoneSchema.optional(),
      email: z.string().trim().toLowerCase().email('Invalid email').optional(),
      avatar: z.string().optional(),
      contactPhone: phoneSchema.optional(),
      monasteryName: z
        .string('Monastery name is required')
        .min(3, 'Monastery name must be at least 3 characters')
        .optional(),
      monasteryAddress: z
        .string('Monastery Address is required')
        .min(3, 'Monastery Address is required at least 3 characters')
        .optional(),
      oldPassword: z.string().optional(),
      newPassword: passwordSchema.optional(),
    })
    .refine(
      (data) => {
        if (data.newPassword && !data.oldPassword) return false;
        return true;
      },
      {
        message: 'Your old password is required to change new password',
        path: ['oldPassword'],
      }
    ),
});
export type getAllUsersInput = z.infer<typeof getAllUsersSchema>['query'];
export type idParamsInput = z.infer<typeof idParamSchema>['params'];
export type updateUserBodyInput = z.infer<typeof updateUserSchema>['body'];
