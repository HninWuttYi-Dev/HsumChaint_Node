import { z } from 'zod';

// Pagination and listing query
export const getRolesQuerySchema = z.object({
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(10),
    roleName: z.string().trim().optional(),
  }),
});

export type GetRolesQueryInput = z.infer<typeof getRolesQuerySchema>['query'];

// Role by ID param
export const roleIdParamSchema = z.object({
  params: z.object({
    id: z.coerce.number().int().positive(),
  }),
});

export type RoleIdParamInput = z.infer<typeof roleIdParamSchema>['params'];

// Create role
export const createRoleSchema = z.object({
  body: z.object({
    roleName: z
      .string('Role name is required')
      .trim()
      .min(1, 'Role name cannot be empty')
      .max(50, 'Role name must not exceed 50 characters'),
    permissionIds: z.array(z.number().int().positive()).optional().default([]),
  }),
});

export type CreateRoleInput = {
  roleName: string;
  permissionIds?: number[];
};

// Update role
export const updateRoleSchema = z.object({
  params: z.object({
    id: z.coerce.number().int().positive(),
  }),
  body: z.object({
    roleName: z
      .string()
      .trim()
      .min(1, 'Role name cannot be empty')
      .max(50, 'Role name must not exceed 50 characters')
      .optional(),
    permissionIds: z.array(z.number().int().positive()).optional(),
  }),
});

export type UpdateRoleInput = z.infer<typeof updateRoleSchema>['body'];

// Assign permissions
export const assignPermissionsSchema = z.object({
  body: z.object({
    roleId: z.number('roleId is required').int().positive(),
    permissionIds: z.array(z.number().int().positive(), 'permissionIds array is required'),
  }),
});

export type AssignPermissionsInput = z.infer<typeof assignPermissionsSchema>['body'];

// Permissions list query
export const getPermissionsQuerySchema = z.object({
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(200).default(100),
    search: z.string().trim().optional(),
    module: z.string().trim().optional(),
  }),
});

export type GetPermissionsQueryInput = z.infer<typeof getPermissionsQuerySchema>['query'];
