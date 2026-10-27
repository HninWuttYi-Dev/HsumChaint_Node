import type { NextFunction, Request, Response } from 'express';
import { generatePaginationData } from '@/helper/paginationHelper';
import { successResponse } from '@/utils/response';
import {
  createMonasteryService,
  deleteMonasteryService,
  getMembersService,
  getMonasteryService,
  getMyMonasteriesService,
  getSpaceRoleByIdService,
  getSpaceRolesService,
  inviteMemberService,
  removeMemberService,
  respondToInvitationService,
  updateMemberRoleService,
  updateMonasteryService,
} from './space.service';

export const getSpaceRoles = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const roles = await getSpaceRolesService();
    return successResponse(res, { roles }, 'Space roles retrieved successfully.');
  } catch (err) {
    next(err);
  }
};

export const getSpaceRoleById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const roleId = Number(req.params.id);
    const role = await getSpaceRoleByIdService(roleId);
    return successResponse(res, role, 'Space role retrieved successfully.');
  } catch (err) {
    next(err);
  }
};

export const createSpace = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const space = await createMonasteryService(req.user.userId, req.body);
    return successResponse(res, space, 'Monastery created successfully.', 201);
  } catch (err) {
    next(err);
  }
};

export const getSpaces = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const search = req.query.search as string | undefined;

    const result = await getMyMonasteriesService(
      req.user.userId,
      { page, limit, search },
      req.user.roleId
    );
    const paginationData = generatePaginationData(req, result.total, page, limit);

    return successResponse(
      res,
      { spaces: result.items, paginationData },
      'Monasteries retrieved successfully.'
    );
  } catch (err) {
    next(err);
  }
};

export const getSpaceById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const spaceId = Number(req.params.id);
    const space = await getMonasteryService(req.user.userId, spaceId, req.user.roleId);
    return successResponse(res, space, 'Monastery retrieved successfully.');
  } catch (err) {
    next(err);
  }
};

export const updateSpace = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const spaceId = Number(req.params.id);
    const updated = await updateMonasteryService(
      req.user.userId,
      spaceId,
      req.body,
      req.user.roleId
    );
    return successResponse(res, updated, 'Monastery updated successfully.');
  } catch (err) {
    next(err);
  }
};

export const deleteSpace = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const spaceId = Number(req.params.id);
    const result = await deleteMonasteryService(req.user.userId, spaceId, req.user.roleId);
    return successResponse(res, result, 'Monastery deleted successfully.');
  } catch (err) {
    next(err);
  }
};

export const inviteMember = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const spaceId = Number(req.params.id);
    const invitation = await inviteMemberService(
      req.user.userId,
      spaceId,
      req.body,
      req.user.roleId
    );
    return successResponse(res, invitation, 'Invitation created successfully.', 201);
  } catch (err) {
    next(err);
  }
};

export const respondToInvitation = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const invitationId = Number(req.params.invitationId);
    const result = await respondToInvitationService(req.user.userId, invitationId, req.body);
    return successResponse(res, result, result.message ?? 'Invitation answered successfully.');
  } catch (err) {
    next(err);
  }
};

export const getSpaceMembers = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const spaceId = Number(req.params.id);
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;

    const result = await getMembersService(
      req.user.userId,
      spaceId,
      { page, limit },
      req.user.roleId
    );
    const paginationData = generatePaginationData(req, result.total, page, limit);

    return successResponse(
      res,
      { members: result.items, paginationData },
      'Members retrieved successfully.'
    );
  } catch (err) {
    next(err);
  }
};

export const updateMemberRole = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const spaceId = Number(req.params.id);
    const userId = Number(req.params.userId);
    const updated = await updateMemberRoleService(
      req.user.userId,
      spaceId,
      userId,
      req.body,
      req.user.roleId
    );
    return successResponse(res, updated, 'Member role updated successfully.');
  } catch (err) {
    next(err);
  }
};

export const removeSpaceMember = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const spaceId = Number(req.params.id);
    const userId = Number(req.params.userId);
    const result = await removeMemberService(req.user.userId, spaceId, userId, req.user.roleId);
    return successResponse(res, result, 'Member removed successfully.');
  } catch (err) {
    next(err);
  }
};
