import { prisma } from '@/lib/prisma';
import { clearRolePermissionsCache } from '@/middlewares/permissionMiddleware';
import { AppError } from '@/utils/AppError';
import type {
  AssignPermissionsInput,
  CreateRoleInput,
  GetPermissionsQueryInput,
  GetRolesQueryInput,
  UpdateRoleInput,
} from './role.schema';

export interface FormattedPermission {
  permissionId: number;
  permissionName: string;
  module: string;
  action: string;
  displayName: string;
  category: string;
}

export interface FormattedRole {
  roleId: number;
  roleName: string;
  isDeleted: boolean;
  permissions: FormattedPermission[];
}

export const formatPermission = (perm: { id: number; name: string }): FormattedPermission => {
  const parts = perm.name.split('.');
  const module = parts.length > 1 ? parts[0] : 'General';
  const action = parts.length > 1 ? parts.slice(1).join('.') : perm.name;

  const category = (() => {
    switch (module) {
      case 'User':
        return 'User Management';
      case 'Role':
        return 'Role & Access Control';
      case 'Donor':
        return 'Donor Management';
      case 'Monastery':
      case 'Space':
        return 'Monastery & Space';
      default:
        return 'General System';
    }
  })();

  return {
    permissionId: perm.id,
    permissionName: perm.name,
    module,
    action,
    displayName: `${action} ${module}`,
    category,
  };
};

export const isSystemAdmin = (role: { id: number; name: string }): boolean => {
  return role.id === 1 || role.id === 3 || role.name.toLowerCase() === 'admin';
};

const stripsAdminPermissions = async (desiredIds: number[]): Promise<boolean> => {
  const allActive = await prisma.permission.findMany({
    where: { isDeleted: false },
    select: { id: true },
  });
  const desired = new Set(desiredIds);
  return allActive.some((p) => !desired.has(p.id));
};

/**
 * Get paginated list of roles with their assigned permissions
 */
export const getRolesService = async (query: GetRolesQueryInput) => {
  const { page = 1, limit = 10, roleName } = query;
  const skip = (page - 1) * limit;

  const whereClause: {
    isDeleted: boolean;
    name?: { contains: string };
  } = {
    isDeleted: false,
  };

  if (roleName) {
    whereClause.name = { contains: roleName.trim() };
  }

  const [roles, total] = await Promise.all([
    prisma.role.findMany({
      where: whereClause,
      skip,
      take: limit,
      orderBy: { id: 'asc' },
      include: {
        rolePermissions: {
          include: {
            permission: true,
          },
        },
      },
    }),
    prisma.role.count({ where: whereClause }),
  ]);

  const items: FormattedRole[] = roles.map((role) => ({
    roleId: role.id,
    roleName: role.name,
    isDeleted: role.isDeleted,
    permissions: role.rolePermissions
      .filter((rp) => rp.permission && !rp.permission.isDeleted)
      .map((rp) => formatPermission(rp.permission)),
  }));

  return {
    items,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
};

/**
 * Get role by ID with permissions
 */
export const getRoleByIdService = async (id: number): Promise<FormattedRole> => {
  const role = await prisma.role.findFirst({
    where: { id, isDeleted: false },
    include: {
      rolePermissions: {
        include: {
          permission: true,
        },
      },
    },
  });

  if (!role) {
    throw new AppError('Role not found', 404);
  }

  return {
    roleId: role.id,
    roleName: role.name,
    isDeleted: role.isDeleted,
    permissions: role.rolePermissions
      .filter((rp) => rp.permission && !rp.permission.isDeleted)
      .map((rp) => formatPermission(rp.permission)),
  };
};

/**
 * Create a new custom role with optional permissions
 */
export const createRoleService = async (data: CreateRoleInput): Promise<FormattedRole> => {
  const trimmedName = data.roleName.trim();
  const normalized = trimmedName.toUpperCase();

  // Check uniqueness
  const existing = await prisma.role.findFirst({
    where: { name: trimmedName, isDeleted: false },
  });
  if (existing || normalized === 'ADMIN') {
    throw new AppError(
      normalized === 'ADMIN'
        ? "The role name 'Admin' is reserved by the system"
        : 'Role name already exists',
      400
    );
  }

  // Validate permission IDs if provided
  const permissionIds = Array.from(new Set(data.permissionIds || []));
  if (permissionIds.length > 0) {
    const validCount = await prisma.permission.count({
      where: {
        id: { in: permissionIds },
        isDeleted: false,
      },
    });
    if (validCount !== permissionIds.length) {
      throw new AppError('One or more permissions are invalid or inactive', 400);
    }
  }

  // Transactionally create role and permissions
  const created = await prisma.$transaction(async (tx) => {
    const role = await tx.role.create({
      data: {
        name: trimmedName,
        isDeleted: false,
      },
    });

    if (permissionIds.length > 0) {
      await tx.rolePermission.createMany({
        data: permissionIds.map((pId) => ({
          roleId: role.id,
          permissionId: pId,
        })),
      });
    }

    return tx.role.findUniqueOrThrow({
      where: { id: role.id },
      include: {
        rolePermissions: {
          include: {
            permission: true,
          },
        },
      },
    });
  });

  return {
    roleId: created.id,
    roleName: created.name,
    isDeleted: created.isDeleted,
    permissions: created.rolePermissions
      .filter((rp) => rp.permission && !rp.permission.isDeleted)
      .map((rp) => formatPermission(rp.permission)),
  };
};

/**
 * Update an existing role and its permissions
 */
export const updateRoleService = async (
  id: number,
  data: UpdateRoleInput
): Promise<FormattedRole> => {
  const role = await prisma.role.findFirst({
    where: { id, isDeleted: false },
    include: {
      rolePermissions: true,
    },
  });

  if (!role) {
    throw new AppError('Role not found', 404);
  }

  const trimmedName = data.roleName?.trim();

  // Protect Admin role
  if (isSystemAdmin(role)) {
    const isRenamed = trimmedName !== undefined && trimmedName !== role.name;
    const isStripped =
      data.permissionIds !== undefined && (await stripsAdminPermissions(data.permissionIds));
    if (isRenamed || isStripped) {
      throw new AppError(
        'The system Admin role cannot be renamed or have permissions removed.',
        400
      );
    }
  }

  // If renaming, ensure uniqueness
  if (trimmedName && trimmedName.toLowerCase() !== role.name.toLowerCase()) {
    const duplicate = await prisma.role.findFirst({
      where: { name: trimmedName, isDeleted: false, id: { not: id } },
    });
    if (duplicate) {
      throw new AppError('Role name already exists', 400);
    }
  }

  // Validate permissions if provided
  let permissionIds: number[] | undefined;
  if (data.permissionIds !== undefined) {
    permissionIds = Array.from(new Set(data.permissionIds));

    if (permissionIds.length > 0) {
      const validCount = await prisma.permission.count({
        where: {
          id: { in: permissionIds },
          isDeleted: false,
        },
      });
      if (validCount !== permissionIds.length) {
        throw new AppError('One or more permissions are invalid or inactive', 400);
      }
    }
  }

  // Perform update in transaction
  const updated = await prisma.$transaction(async (tx) => {
    if (trimmedName) {
      await tx.role.update({
        where: { id },
        data: { name: trimmedName },
      });
    }

    if (permissionIds !== undefined) {
      await tx.rolePermission.deleteMany({
        where: { roleId: id },
      });

      if (permissionIds.length > 0) {
        await tx.rolePermission.createMany({
          data: permissionIds.map((pId) => ({
            roleId: id,
            permissionId: pId,
          })),
        });
      }
    }

    return tx.role.findUniqueOrThrow({
      where: { id },
      include: {
        rolePermissions: {
          include: {
            permission: true,
          },
        },
      },
    });
  });

  // Invalidate Redis cache
  await clearRolePermissionsCache(id);

  return {
    roleId: updated.id,
    roleName: updated.name,
    isDeleted: updated.isDeleted,
    permissions: updated.rolePermissions
      .filter((rp) => rp.permission && !rp.permission.isDeleted)
      .map((rp) => formatPermission(rp.permission)),
  };
};

/**
 * Soft delete a role (matching C# DeleteRole)
 */
export const deleteRoleService = async (id: number): Promise<{ message: string }> => {
  const role = await prisma.role.findFirst({
    where: { id, isDeleted: false },
  });

  if (!role) {
    throw new AppError('Role not found', 404);
  }

  // System Admin cannot be deleted
  if (isSystemAdmin(role)) {
    throw new AppError('The system Admin role cannot be deleted.', 400);
  }

  // Check if role is assigned to users, members, or pending invitations
  const [hasUser, hasMember, hasInvitation] = await Promise.all([
    prisma.user.findFirst({ where: { roleId: id, isDeleted: false } }),
    prisma.monasteryMember.findFirst({ where: { role: id } }),
    prisma.invitation.findFirst({ where: { role: id, status: 0 } }),
  ]);

  if (hasUser || hasMember || hasInvitation) {
    throw new AppError('Role is assigned to users, members or pending invitations.', 400);
  }

  await prisma.role.update({
    where: { id },
    data: { isDeleted: true },
  });

  await clearRolePermissionsCache(id);

  return { message: 'Role deleted successfully' };
};

/**
 * Get all active permissions catalog with pagination & search
 */
export const getPermissionsService = async (query: GetPermissionsQueryInput) => {
  const { page = 1, limit = 100, search, module } = query;
  const skip = (page - 1) * limit;

  const whereClause: {
    isDeleted: boolean;
    name?: { contains?: string; startsWith?: string };
  } = {
    isDeleted: false,
  };

  if (search) {
    whereClause.name = { contains: search.trim() };
  } else if (module) {
    whereClause.name = { startsWith: `${module.trim()}.` };
  }

  const [permissions, total] = await Promise.all([
    prisma.permission.findMany({
      where: whereClause,
      skip,
      take: limit,
      orderBy: { name: 'asc' },
    }),
    prisma.permission.count({ where: whereClause }),
  ]);

  return {
    items: permissions.map(formatPermission),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
};

/**
 * Assign / Replace permissions for a given role (matching C# AssignPermissions)
 */
export const assignPermissionsService = async (data: AssignPermissionsInput) => {
  const { roleId, permissionIds } = data;

  const role = await prisma.role.findFirst({
    where: { id: roleId, isDeleted: false },
  });

  if (!role) {
    throw new AppError('Role not found', 404);
  }

  const distinctIds = Array.from(new Set(permissionIds));

  // Protect system admin
  if (isSystemAdmin(role) && (await stripsAdminPermissions(distinctIds))) {
    throw new AppError('The system Admin role cannot have permissions removed.', 400);
  }

  if (distinctIds.length > 0) {
    const validCount = await prisma.permission.count({
      where: {
        id: { in: distinctIds },
        isDeleted: false,
      },
    });
    if (validCount !== distinctIds.length) {
      throw new AppError('One or more permissions are invalid or inactive', 400);
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.rolePermission.deleteMany({
      where: { roleId },
    });

    if (distinctIds.length > 0) {
      await tx.rolePermission.createMany({
        data: distinctIds.map((pId) => ({
          roleId,
          permissionId: pId,
        })),
      });
    }
  });

  // Invalidate Redis cache
  await clearRolePermissionsCache(roleId);

  return { message: 'Permissions assigned successfully', roleId, count: distinctIds.length };
};

/**
 * Get distinct active permissions for a specific user (matching C# GetUserPermissions)
 */
export const getUserPermissionsService = async (userId: number): Promise<string[]> => {
  const user = await prisma.user.findFirst({
    where: { id: userId, isDeleted: false },
    include: { role: true },
  });

  if (!user || user.role.isDeleted) {
    return [];
  }

  const rolePermissions = await prisma.rolePermission.findMany({
    where: {
      roleId: user.roleId,
      permission: { isDeleted: false },
    },
    include: {
      permission: true,
    },
    orderBy: {
      permission: { name: 'asc' },
    },
  });

  return rolePermissions
    .map((rp) => rp.permission?.name)
    .filter((name): name is string => Boolean(name));
};
