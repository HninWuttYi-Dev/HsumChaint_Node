import { Router } from 'express';
import { authMiddleWare } from '@/middlewares/authMiddleWare';
import { checkPermission } from '@/middlewares/permissionMiddleware';
import { validator } from '@/middlewares/validator';
import {
  assignPermissions,
  createRole,
  deleteRole,
  getMyPermissions,
  getPermissions,
  getRoleById,
  getRoles,
  getUserPermissions,
  updateRole,
} from './role.controller';
import {
  assignPermissionsSchema,
  createRoleSchema,
  getPermissionsQuerySchema,
  getRolesQuerySchema,
  roleIdParamSchema,
  updateRoleSchema,
} from './role.schema';

const router = Router();

// Require authentication for all role/permission routes
router.use(authMiddleWare);

// 1. Permissions catalog endpoint
router.get('/permissions', validator(getPermissionsQuerySchema), getPermissions);

// 2. Assign permissions endpoint
router.post(
  '/assign',
  checkPermission('Role.Update'),
  validator(assignPermissionsSchema),
  assignPermissions
);

// 3. User permission queries
router.get('/me/permissions', getMyPermissions);
router.get('/users/:userId/permissions', checkPermission('Role.View'), getUserPermissions);

// 4. Role endpoints (supports both standard REST / and BookStorePOS /roles paths)
router.get('/', checkPermission('Role.View'), validator(getRolesQuerySchema), getRoles);
router.get('/roles', checkPermission('Role.View'), validator(getRolesQuerySchema), getRoles);

router.post('/', checkPermission('Role.Create'), validator(createRoleSchema), createRole);
router.post('/roles', checkPermission('Role.Create'), validator(createRoleSchema), createRole);

router.get('/:id', checkPermission('Role.View'), validator(roleIdParamSchema), getRoleById);
router.get('/roles/:id', checkPermission('Role.View'), validator(roleIdParamSchema), getRoleById);

router.put('/:id', checkPermission('Role.Update'), validator(updateRoleSchema), updateRole);
router.put('/roles/:id', checkPermission('Role.Update'), validator(updateRoleSchema), updateRole);

router.delete('/:id', checkPermission('Role.Delete'), validator(roleIdParamSchema), deleteRole);
router.delete(
  '/roles/:id',
  checkPermission('Role.Delete'),
  validator(roleIdParamSchema),
  deleteRole
);

export default router;
