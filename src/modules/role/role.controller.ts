import type { NextFunction, Request, Response } from 'express';
import { generatePaginationData } from '@/helper/paginationHelper';
import { successResponse } from '@/utils/response';
import type {
  AssignPermissionsInput,
  CreateRoleInput,
  GetPermissionsQueryInput,
  GetRolesQueryInput,
  UpdateRoleInput,
} from './role.schema';
import {
  assignPermissionsService,
  createRoleService,
  deleteRoleService,
  getPermissionsService,
  getRoleByIdService,
  getRolesService,
  getUserPermissionsService,
  updateRoleService,
} from './role.service';

export const getRoles = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawQuery = req.query as Record<string, string>;
    const page = Number(rawQuery.page) || 1;
    const limit = Number(rawQuery.limit) || 10;

    const queryData: GetRolesQueryInput = {
      page,
      limit,
      roleName: rawQuery.roleName,
    };

    const result = await getRolesService(queryData);
    const paginationData = generatePaginationData(req, result.total, page, limit);

    return successResponse(
      res,
      { roles: result.items, paginationData },
      'Roles retrieved successfully'
    );
  } catch (err) {
    next(err);
  }
};

export const getRoleById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const roleId = Number(req.params.id);
    const role = await getRoleByIdService(roleId);
    return successResponse(res, role, 'Role retrieved successfully');
  } catch (err) {
    next(err);
  }
};

export const createRole = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = req.body as CreateRoleInput;
    const role = await createRoleService(data);
    return successResponse(res, role, 'Role created successfully', 201);
  } catch (err) {
    next(err);
  }
};

export const updateRole = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const roleId = Number(req.params.id);
    const data = req.body as UpdateRoleInput;
    const role = await updateRoleService(roleId, data);
    return successResponse(res, role, 'Role updated successfully');
  } catch (err) {
    next(err);
  }
};

export const deleteRole = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const roleId = Number(req.params.id);
    const result = await deleteRoleService(roleId);
    return successResponse(res, result, result.message);
  } catch (err) {
    next(err);
  }
};

export const getPermissions = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawQuery = req.query as Record<string, string>;
    const page = Number(rawQuery.page) || 1;
    const limit = Number(rawQuery.limit) || 100;

    const queryData: GetPermissionsQueryInput = {
      page,
      limit,
      search: rawQuery.search,
      module: rawQuery.module,
    };

    const result = await getPermissionsService(queryData);
    const paginationData = generatePaginationData(req, result.total, page, limit);

    return successResponse(
      res,
      { permissions: result.items, paginationData },
      'Permissions retrieved successfully'
    );
  } catch (err) {
    next(err);
  }
};

export const assignPermissions = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = req.body as AssignPermissionsInput;
    const result = await assignPermissionsService(data);
    return successResponse(res, result, 'Permissions assigned successfully');
  } catch (err) {
    next(err);
  }
};

export const getMyPermissions = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user.userId;
    const permissions = await getUserPermissionsService(userId);
    return successResponse(res, { permissions }, 'User permissions retrieved successfully');
  } catch (err) {
    next(err);
  }
};

export const getUserPermissions = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = Number(req.params.userId);
    const permissions = await getUserPermissionsService(userId);
    return successResponse(res, { permissions }, 'User permissions retrieved successfully');
  } catch (err) {
    next(err);
  }
};
