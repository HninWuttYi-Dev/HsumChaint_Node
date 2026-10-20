import { Router } from 'express';
import { authMiddleware } from '@/middlewares/authMiddleWare';
import { validator } from '@/middlewares/validator';
import {
  createSpace,
  deleteSpace,
  getSpaceById,
  getSpaceMembers,
  getSpaces,
  inviteMember,
  removeSpaceMember,
  respondToInvitation,
  updateMemberRole,
  updateSpace,
} from './space.controller';
import {
  createSpaceSchema,
  inviteMemberSchema,
  removeMemberSchema,
  respondInvitationSchema,
  spaceIdParamSchema,
  spacePaginationSchema,
  updateMemberRoleSchema,
  updateSpaceSchema,
} from './space.schema';

export const spaceRouter = Router();

// All space/monastery endpoints require authentication
spaceRouter.use(authMiddleware);

// 1. Space / Monastery CRUD
spaceRouter.post('/', validator(createSpaceSchema), createSpace);
spaceRouter.get('/', validator(spacePaginationSchema), getSpaces);
spaceRouter.get('/:id', validator(spaceIdParamSchema), getSpaceById);
spaceRouter.put('/:id', validator(updateSpaceSchema), updateSpace);
spaceRouter.delete('/:id', validator(spaceIdParamSchema), deleteSpace);

// 2. Member Invitations
spaceRouter.post('/:id/invitations', validator(inviteMemberSchema), inviteMember);
spaceRouter.post(
  '/invitations/:invitationId/respond',
  validator(respondInvitationSchema),
  respondToInvitation
);

// 3. Member Management
spaceRouter.get('/:id/members', validator(spaceIdParamSchema), getSpaceMembers);
spaceRouter.put(
  '/:id/members/:memberUserId/role',
  validator(updateMemberRoleSchema),
  updateMemberRole
);
spaceRouter.put('/:id/members/:userId', validator(updateMemberRoleSchema), updateMemberRole);
spaceRouter.delete('/:id/members/:memberUserId', validator(removeMemberSchema), removeSpaceMember);
spaceRouter.delete('/:id/members/:userId', validator(removeMemberSchema), removeSpaceMember);

export default spaceRouter;
