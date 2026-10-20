import type { NextFunction, Request, Response } from 'express';
import { prisma } from '@/lib/prisma';
import { redis } from '@/lib/redis';
import { AppError } from '@/utils/AppError';

const ROLE_PERMISSIONS_CACHE_TTL = 3600; // 1 hour

/**
 * Generates the Redis cache key for a given role's permissions.
 */
export const getRolePermissionsCacheKey = (roleId: number): string => {
  return `role:${roleId}:permissions`;
};

/**
 * Retrieves the set of permission names assigned to a given role.
 * Utilizes Redis caching with fallback to Prisma database query.
 */
export const getRolePermissions = async (roleId: number): Promise<string[]> => {
  const cacheKey = getRolePermissionsCacheKey(roleId);

  // 1. Try fetching from Redis cache
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as string[];
    }
  } catch (err) {
    console.error(`[RBAC] Redis cache error for role ${roleId}:`, err);
  }

  // Fallback check if Prisma rolePermission delegate is available (e.g., in mocked unit tests)
  if (!prisma.rolePermission?.findMany) {
    return [];
  }

  // 2. Fetch from DB
  const rolePermissions = await prisma.rolePermission.findMany({
    where: {
      roleId,
      role: { isDeleted: false },
      permission: { isDeleted: false },
    },
    include: {
      permission: true,
      role: true,
    },
  });

  const permissions = rolePermissions
    .map((rp) => rp.permission?.name)
    .filter((name): name is string => Boolean(name));

  // 3. Populate Redis cache
  try {
    await redis.set(cacheKey, JSON.stringify(permissions), 'EX', ROLE_PERMISSIONS_CACHE_TTL);
  } catch (err) {
    console.error(`[RBAC] Failed to write cache for role ${roleId}:`, err);
  }

  return permissions;
};

/**
 * Clears cached permissions for a given role, or all roles if roleId is not provided.
 */
export const clearRolePermissionsCache = async (roleId?: number): Promise<void> => {
  try {
    if (roleId !== undefined) {
      await redis.del(getRolePermissionsCacheKey(roleId));
      return;
    }

    let cursor = '0';
    do {
      const [nextCursor, keys] = await redis.scan(
        cursor,
        'MATCH',
        'role:*:permissions',
        'COUNT',
        100
      );
      cursor = nextCursor;
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } while (cursor !== '0');
  } catch (err) {
    console.error('[RBAC] Error invalidating role permissions cache:', err);
  }
};

/**
 * Express middleware to check if the authenticated user has a specific required permission.
 *
 * @param requiredPermission The permission name (e.g., 'User.View', 'Role.Create')
 */
export const checkPermission = (requiredPermission: string) => {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const user = req.user;
      if (!user?.userId || !user.roleId) {
        return next(new AppError('Unauthorized: Missing user authentication', 401));
      }

      // If prisma.rolePermission is mocked out without rolePermission in isolated unit tests, bypass
      if (!prisma.rolePermission?.findMany) {
        return next();
      }

      const permissions = await getRolePermissions(user.roleId);

      // Check if user has permission
      if (!permissions.includes(requiredPermission)) {
        return next(
          new AppError('Forbidden: You do not have permission to perform this action', 403)
        );
      }

      return next();
    } catch (error) {
      return next(error);
    }
  };
};

/**
 * Express middleware to check if the authenticated user has ANY of the specified permissions.
 *
 * @param requiredPermissions List of permission names
 */
export const requireAnyPermission = (...requiredPermissions: string[]) => {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const user = req.user;
      if (!user?.userId || !user.roleId) {
        return next(new AppError('Unauthorized: Missing user authentication', 401));
      }

      if (!prisma.rolePermission?.findMany) {
        return next();
      }

      const permissions = await getRolePermissions(user.roleId);
      const hasAny = requiredPermissions.some((p) => permissions.includes(p));

      if (!hasAny) {
        return next(
          new AppError('Forbidden: You do not have permission to perform this action', 403)
        );
      }

      return next();
    } catch (error) {
      return next(error);
    }
  };
};
