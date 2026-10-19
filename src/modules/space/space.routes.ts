import { type RequestHandler, Router } from 'express';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { redis } from '@/lib/redis';
import { authMiddleware } from '@/middlewares/authMiddleWare';
import { AppError } from '@/utils/AppError';
import { SPACE_PERMISSIONS, type SpacePermission } from './space.permissions';
import { createSpaceService } from './space.service';

export const spaceService = createSpaceService(prisma, redis);
const id = z.coerce.number().int().positive().max(2147483647);
const spaceBody = z
  .object({
    name: z.string().trim().min(1).max(191),
    description: z.string().max(10000).optional(),
  })
  .strict();
const roleBody = z
  .object({
    name: z.string().trim().min(1).max(191),
    permissions: z
      .array(z.enum(SPACE_PERMISSIONS))
      .max(SPACE_PERMISSIONS.length)
      .transform((keys) => [...new Set(keys)]),
  })
  .strict();
const memberBody = z.object({ userId: id, roleId: id }).strict();
const pagination = z.object({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const checkSpacePermission =
  (permission: SpacePermission): RequestHandler =>
  async (req, _res, next) => {
    try {
      await spaceService.authorize(req.user.userId, id.parse(req.params.spaceId), permission);
      next();
    } catch (error) {
      next(error);
    }
  };

export const spaceRouter = Router();
spaceRouter.use(authMiddleware);
const endpoint =
  (handler: RequestHandler): RequestHandler =>
  async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res
          .status(400)
          .json({ status: 'failed', message: 'Validation Error', detail: error.issues });
        return;
      }
      if (typeof error === 'object' && error !== null && 'code' in error) {
        if (error.code === 'P2002')
          return next(new AppError('Role name or membership already exists', 409));
        if (error.code === 'P2025') return next(new AppError('Space resource not found', 404));
        if (error.code === 'P2003')
          return next(new AppError('Invalid space resource reference', 400));
      }
      next(error);
    }
  };
spaceRouter.post(
  '/',
  endpoint(async (req, res) => {
    res
      .status(201)
      .json({ data: await spaceService.create(req.user.userId, spaceBody.parse(req.body)) });
  })
);
spaceRouter.get(
  '/',
  endpoint(async (req, res) => {
    const { page, limit } = pagination.parse(req.query);
    res.json({ data: await spaceService.list(req.user.userId, (page - 1) * limit, limit) });
  })
);
spaceRouter.get('/permissions', (_req, res) => {
  res.json({ data: SPACE_PERMISSIONS });
});
spaceRouter.get(
  '/:spaceId',
  endpoint(async (req, res) => {
    res.json({
      data: await spaceService.authorize(
        req.user.userId,
        id.parse(req.params.spaceId),
        'Space.View'
      ),
    });
  })
);
spaceRouter.patch(
  '/:spaceId',
  endpoint(async (req, res) => {
    res.json({
      data: await spaceService.update(
        req.user.userId,
        id.parse(req.params.spaceId),
        spaceBody.partial().parse(req.body)
      ),
    });
  })
);
spaceRouter.delete(
  '/:spaceId',
  endpoint(async (req, res) => {
    await spaceService.remove(req.user.userId, id.parse(req.params.spaceId));
    res.status(204).end();
  })
);
spaceRouter.get(
  '/:spaceId/roles',
  endpoint(async (req, res) => {
    res.json({ data: await spaceService.roles(req.user.userId, id.parse(req.params.spaceId)) });
  })
);
spaceRouter.post(
  '/:spaceId/roles',
  endpoint(async (req, res) => {
    res.status(201).json({
      data: await spaceService.saveRole(
        req.user.userId,
        id.parse(req.params.spaceId),
        roleBody.parse(req.body)
      ),
    });
  })
);
spaceRouter.put(
  '/:spaceId/roles/:roleId',
  endpoint(async (req, res) => {
    res.json({
      data: await spaceService.saveRole(
        req.user.userId,
        id.parse(req.params.spaceId),
        roleBody.parse(req.body),
        id.parse(req.params.roleId)
      ),
    });
  })
);
spaceRouter.get(
  '/:spaceId/members',
  endpoint(async (req, res) => {
    const { page, limit } = pagination.parse(req.query);
    res.json({
      data: await spaceService.members(
        req.user.userId,
        id.parse(req.params.spaceId),
        (page - 1) * limit,
        limit
      ),
    });
  })
);
spaceRouter.post(
  '/:spaceId/members',
  endpoint(async (req, res) => {
    const body = memberBody.parse(req.body);
    res.status(201).json({
      data: await spaceService.setMember(
        req.user.userId,
        id.parse(req.params.spaceId),
        body.userId,
        body.roleId,
        true
      ),
    });
  })
);
spaceRouter.patch(
  '/:spaceId/members/:userId',
  endpoint(async (req, res) => {
    const body = memberBody.omit({ userId: true }).parse(req.body);
    res.json({
      data: await spaceService.setMember(
        req.user.userId,
        id.parse(req.params.spaceId),
        id.parse(req.params.userId),
        body.roleId,
        false
      ),
    });
  })
);
spaceRouter.delete(
  '/:spaceId/members/:userId',
  endpoint(async (req, res) => {
    await spaceService.removeMember(
      req.user.userId,
      id.parse(req.params.spaceId),
      id.parse(req.params.userId)
    );
    res.status(204).end();
  })
);
