import { prisma } from '@/lib/prisma';
import { AppError } from '@/utils/AppError';
import type {
  CreateSpaceInput,
  InviteMemberInput,
  RespondInvitationInput,
  UpdateMemberRoleInput,
  UpdateSpaceInput,
} from './space.schema';

export interface MonasterySpaceDto {
  id: number;
  monasteryName: string;
  description: string | null;
  address: string | null;
  createdById: number;
  currentUserRoleId: number | null;
  currentUserRoleName: string | null;
  isOwner: boolean;
}

export interface MonasteryMemberDto {
  id: number;
  userId: number;
  name: string | null;
  phone: string | null;
  monasterySpaceId: number;
  roleId: number;
  roleName: string | null;
  isOwner: boolean;
}

export interface InvitationResponseDto {
  invitationId: number;
  monasterySpaceId: number;
  invitedUserId: number;
  invitedById: number;
  roleId: number;
  roleName: string | null;
  status: number;
  createdAt: Date;
  message?: string;
}

/**
 * Checks if the member has permission to manage monastery (owner or has Monastery.ManageMembers)
 */
export const canManageMonastery = async (
  member: { role: number; isOwner: boolean } | null
): Promise<boolean> => {
  if (!member) return false;
  if (member.isOwner) return true;

  const count = await prisma.rolePermission.count({
    where: {
      roleId: member.role,
      role: { isDeleted: false },
      permission: {
        isDeleted: false,
        name: { in: ['Monastery.ManageMembers', 'Space.Member.Manage'] },
      },
    },
  });
  return count > 0;
};

/**
 * Checks if the member can delete the monastery:
 * must be Owner, Monk role, and have Monastery.Delete permission
 */
export const canDeleteMonastery = async (
  member:
    | ({ role: number; isOwner: boolean } & {
        roleData?: { name: string; isDeleted: boolean } | null;
      })
    | null
): Promise<boolean> => {
  if (!member?.isOwner) return false;

  const role =
    member.roleData ??
    (await prisma.role.findFirst({
      where: { id: member.role, isDeleted: false },
    }));

  if (!role || role.isDeleted || role.name.toLowerCase() !== 'monk') {
    return false;
  }

  const count = await prisma.rolePermission.count({
    where: {
      roleId: member.role,
      role: { isDeleted: false },
      permission: {
        isDeleted: false,
        name: { in: ['Monastery.Delete', 'Space.Delete'] },
      },
    },
  });
  return count > 0;
};

/**
 * Helper to get a member of a monastery space
 */
export const getMember = async (userId: number, monasterySpaceId: number) => {
  return await prisma.monasteryMember.findFirst({
    where: {
      userId,
      monasterySpaceId,
      monasterySpace: { isDeleted: false },
    },
  });
};

/**
 * Create Monastery (matching C# CreateMonastery)
 */
export const createMonasteryService = async (
  currentUserId: number,
  request: CreateSpaceInput
): Promise<MonasterySpaceDto> => {
  if (!request.monasteryName || request.monasteryName.trim().length === 0) {
    throw new AppError('Monastery name is required.', 400);
  }

  const creator = await prisma.user.findFirst({
    where: { id: currentUserId, isDeleted: false },
    include: { role: true },
  });

  if (!creator?.role || creator.role.isDeleted) {
    throw new AppError('User or active role not found.', 404);
  }

  return await prisma.$transaction(async (tx) => {
    const monastery = await tx.monasterySpace.create({
      data: {
        monasteryName: request.monasteryName.trim(),
        description: request.description?.trim(),
        address: request.address?.trim(),
        createdById: currentUserId,
        isDeleted: false,
      },
    });

    await tx.monasteryMember.create({
      data: {
        userId: currentUserId,
        monasterySpaceId: monastery.id,
        role: creator.roleId,
        isOwner: true,
      },
    });

    return {
      id: monastery.id,
      monasteryName: monastery.monasteryName,
      description: monastery.description,
      address: monastery.address,
      createdById: monastery.createdById,
      currentUserRoleId: creator.roleId,
      currentUserRoleName: creator.role.name,
      isOwner: true,
    };
  });
};

/**
 * Update Monastery (matching C# UpdateMonastery)
 */
export const updateMonasteryService = async (
  currentUserId: number,
  monasterySpaceId: number,
  request: UpdateSpaceInput
): Promise<MonasterySpaceDto> => {
  const member = await getMember(currentUserId, monasterySpaceId);

  if (!(await canManageMonastery(member))) {
    throw new AppError('User is not authorized to manage this monastery.', 403);
  }

  const monastery = await prisma.monasterySpace.findFirst({
    where: { id: monasterySpaceId, isDeleted: false },
  });
  if (!monastery) {
    throw new AppError('Monastery not found.', 404);
  }

  const updated = await prisma.monasterySpace.update({
    where: { id: monasterySpaceId },
    data: {
      monasteryName: request.monasteryName?.trim() || monastery.monasteryName,
      description:
        request.description !== undefined ? request.description.trim() : monastery.description,
      address: request.address !== undefined ? request.address.trim() : monastery.address,
    },
  });

  const memberRole = member?.role;
  const isOwner = member?.isOwner ?? false;
  const role = memberRole ? await prisma.role.findUnique({ where: { id: memberRole } }) : null;

  return {
    id: updated.id,
    monasteryName: updated.monasteryName,
    description: updated.description,
    address: updated.address,
    createdById: updated.createdById,
    currentUserRoleId: memberRole ?? null,
    currentUserRoleName: role?.name ?? null,
    isOwner,
  };
};

/**
 * Delete Monastery (matching C# DeleteMonastery: soft delete)
 */
export const deleteMonasteryService = async (
  currentUserId: number,
  monasterySpaceId: number
): Promise<{ success: boolean; message: string }> => {
  const monastery = await prisma.monasterySpace.findFirst({
    where: { id: monasterySpaceId, isDeleted: false },
  });
  if (!monastery) {
    throw new AppError('Monastery not found.', 404);
  }

  const member = await getMember(currentUserId, monasterySpaceId);
  if (!(await canDeleteMonastery(member))) {
    throw new AppError(
      'User is not authorized to delete this monastery. Only the monastery owner (Monk) can delete the space.',
      403
    );
  }

  await prisma.monasterySpace.update({
    where: { id: monasterySpaceId },
    data: { isDeleted: true },
  });

  return { success: true, message: 'Monastery deleted successfully.' };
};

/**
 * Get Monastery by ID (matching C# GetMonastery)
 */
export const getMonasteryService = async (
  currentUserId: number,
  monasterySpaceId: number
): Promise<MonasterySpaceDto> => {
  const member = await getMember(currentUserId, monasterySpaceId);
  if (!member) {
    throw new AppError('User is not a member of this monastery.', 403);
  }

  const monastery = await prisma.monasterySpace.findFirst({
    where: { id: monasterySpaceId, isDeleted: false },
  });
  if (!monastery) {
    throw new AppError('Monastery not found.', 404);
  }

  const role = await prisma.role.findUnique({ where: { id: member.role } });

  return {
    id: monastery.id,
    monasteryName: monastery.monasteryName,
    description: monastery.description,
    address: monastery.address,
    createdById: monastery.createdById,
    currentUserRoleId: member.role,
    currentUserRoleName: role?.name ?? null,
    isOwner: member.isOwner,
  };
};

/**
 * Get My Monasteries (matching C# GetMyMonasteries)
 */
export const getMyMonasteriesService = async (
  currentUserId: number,
  pagination: { page?: number; limit?: number; search?: string }
) => {
  const page = pagination.page && pagination.page > 0 ? pagination.page : 1;
  const limit = pagination.limit && pagination.limit > 0 ? pagination.limit : 10;
  const skip = (page - 1) * limit;

  const whereClause: {
    userId: number;
    monasterySpace: {
      isDeleted: boolean;
      OR?: { monasteryName?: { contains: string }; description?: { contains: string } }[];
    };
  } = {
    userId: currentUserId,
    monasterySpace: {
      isDeleted: false,
    },
  };

  if (pagination.search) {
    whereClause.monasterySpace.OR = [
      { monasteryName: { contains: pagination.search.trim() } },
      { description: { contains: pagination.search.trim() } },
    ];
  }

  const [memberships, total] = await Promise.all([
    prisma.monasteryMember.findMany({
      where: whereClause,
      skip,
      take: limit,
      include: {
        monasterySpace: true,
      },
      orderBy: { id: 'asc' },
    }),
    prisma.monasteryMember.count({ where: whereClause }),
  ]);

  const roleIds = Array.from(new Set(memberships.map((m) => m.role)));
  const roles = await prisma.role.findMany({ where: { id: { in: roleIds } } });
  const roleMap = new Map(roles.map((r) => [r.id, r.name]));

  const items: MonasterySpaceDto[] = memberships.map((m) => ({
    id: m.monasterySpace.id,
    monasteryName: m.monasterySpace.monasteryName,
    description: m.monasterySpace.description,
    address: m.monasterySpace.address,
    createdById: m.monasterySpace.createdById,
    currentUserRoleId: m.role,
    currentUserRoleName: roleMap.get(m.role) ?? null,
    isOwner: m.isOwner,
  }));

  return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
};

/**
 * Invite Member to Monastery (matching C# InviteMember)
 */
export const inviteMemberService = async (
  currentUserId: number,
  monasterySpaceId: number,
  request: InviteMemberInput
): Promise<InvitationResponseDto> => {
  const inviter = await getMember(currentUserId, monasterySpaceId);
  if (!(await canManageMonastery(inviter))) {
    throw new AppError('User is not authorized to invite monastery members.', 403);
  }

  const role = await prisma.role.findFirst({
    where: { id: request.roleId, isDeleted: false },
  });
  if (!role) {
    throw new AppError('Role not found.', 404);
  }

  let invitedUser = null;
  const targetPhone = (request.phone ?? request.phoneNumber)?.trim();
  const normalizedPhone = targetPhone
    ? targetPhone.startsWith('+959')
      ? `09${targetPhone.slice(4)}`
      : targetPhone.startsWith('959')
        ? `09${targetPhone.slice(3)}`
        : targetPhone
    : undefined;

  if (request.userId) {
    invitedUser = await prisma.user.findFirst({
      where: { id: request.userId, isDeleted: false },
    });
  } else if (normalizedPhone) {
    invitedUser = await prisma.user.findFirst({
      where: {
        OR: [{ phone: normalizedPhone }, { phone: targetPhone }],
        isDeleted: false,
      },
    });
  }

  if (!invitedUser) {
    throw new AppError('Invited user not found.', 404);
  }

  if (invitedUser.id === currentUserId) {
    throw new AppError('User cannot invite themselves.', 400);
  }

  const existingMember = await getMember(invitedUser.id, monasterySpaceId);
  if (existingMember) {
    throw new AppError('User is already a monastery member.', 400);
  }

  const existingInvitation = await prisma.invitation.findFirst({
    where: {
      monasterySpaceId,
      invitedUserId: invitedUser.id,
      status: 0, // Pending
    },
  });
  if (existingInvitation) {
    throw new AppError('User already has a pending invitation.', 400);
  }

  return await prisma.$transaction(async (tx) => {
    const invitation = await tx.invitation.create({
      data: {
        monasterySpaceId,
        invitedUserId: invitedUser.id,
        invitedById: currentUserId,
        role: request.roleId,
        status: 0, // Pending
      },
    });

    await tx.notification.create({
      data: {
        userId: invitedUser.id,
        type: 1, // NotificationType.Invitation
        message: 'You have a new monastery invitation.',
        isRead: false,
        isDeleted: false,
      },
    });

    return {
      invitationId: invitation.id,
      monasterySpaceId,
      invitedUserId: invitedUser.id,
      invitedById: currentUserId,
      roleId: request.roleId,
      roleName: role.name,
      status: invitation.status,
      createdAt: invitation.createdAt,
    };
  });
};

/**
 * Respond to Invitation (matching C# RespondToInvitation)
 */
export const respondToInvitationService = async (
  currentUserId: number,
  invitationId: number,
  request: RespondInvitationInput
): Promise<InvitationResponseDto> => {
  const isAccept = request.status === 1;
  const isReject = request.status === 0 || request.status === 2;
  if (!isAccept && !isReject) {
    throw new AppError('Invitation response must be Accept or Reject.', 400);
  }
  const resolvedStatus = isAccept ? 1 : 2;

  const invitation = await prisma.invitation.findUnique({
    where: { id: invitationId },
  });
  if (!invitation) {
    throw new AppError('Invitation not found.', 404);
  }

  if (invitation.invitedUserId !== currentUserId) {
    throw new AppError('User is not authorized to respond to this invitation.', 403);
  }

  if (invitation.status !== 0) {
    throw new AppError('Invitation has already been answered.', 400);
  }

  const role = await prisma.role.findFirst({
    where: { id: invitation.role, isDeleted: false },
  });

  if (resolvedStatus === 1) {
    // Accept
    if (!role) {
      throw new AppError('Invitation role is inactive or not found.', 400);
    }

    const existingMember = await getMember(currentUserId, invitation.monasterySpaceId);
    if (!existingMember) {
      await prisma.monasteryMember.create({
        data: {
          userId: currentUserId,
          monasterySpaceId: invitation.monasterySpaceId,
          role: invitation.role,
          isOwner: false,
        },
      });
    }
  }

  const updated = await prisma.invitation.update({
    where: { id: invitationId },
    data: { status: resolvedStatus },
  });

  return {
    invitationId: updated.id,
    monasterySpaceId: updated.monasterySpaceId,
    invitedUserId: updated.invitedUserId,
    invitedById: updated.invitedById,
    roleId: updated.role,
    roleName: role?.name ?? null,
    status: updated.status,
    createdAt: updated.createdAt,
    message:
      resolvedStatus === 1
        ? 'Invitation accepted successfully.'
        : 'Invitation rejected successfully.',
  };
};

/**
 * Get Members of Monastery (matching C# GetMembers)
 */
export const getMembersService = async (
  currentUserId: number,
  monasterySpaceId: number,
  pagination: { page?: number; limit?: number }
) => {
  const member = await getMember(currentUserId, monasterySpaceId);
  if (!member) {
    throw new AppError('User is not a member of this monastery.', 403);
  }

  const page = pagination.page && pagination.page > 0 ? pagination.page : 1;
  const limit = pagination.limit && pagination.limit > 0 ? pagination.limit : 10;
  const skip = (page - 1) * limit;

  const [memberships, total] = await Promise.all([
    prisma.monasteryMember.findMany({
      where: { monasterySpaceId },
      skip,
      take: limit,
      orderBy: { id: 'asc' },
      include: {
        user: {
          select: { id: true, name: true, phone: true },
        },
      },
    }),
    prisma.monasteryMember.count({ where: { monasterySpaceId } }),
  ]);

  const roleIds = Array.from(new Set(memberships.map((m) => m.role)));
  const roles = await prisma.role.findMany({ where: { id: { in: roleIds } } });
  const roleMap = new Map(roles.map((r) => [r.id, r.name]));

  const items: MonasteryMemberDto[] = memberships.map((m) => ({
    id: m.id,
    userId: m.user.id,
    name: m.user.name,
    phone: m.user.phone,
    monasterySpaceId: m.monasterySpaceId,
    roleId: m.role,
    roleName: roleMap.get(m.role) ?? null,
    isOwner: m.isOwner,
  }));

  return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
};

/**
 * Update Member Role (matching C# UpdateMemberRole)
 */
export const updateMemberRoleService = async (
  currentUserId: number,
  monasterySpaceId: number,
  memberUserId: number,
  request: UpdateMemberRoleInput
): Promise<MonasteryMemberDto> => {
  const actor = await getMember(currentUserId, monasterySpaceId);
  if (!(await canManageMonastery(actor))) {
    throw new AppError('User is not authorized to manage monastery members.', 403);
  }

  const role = await prisma.role.findFirst({
    where: { id: request.roleId, isDeleted: false },
  });
  if (!role) {
    throw new AppError('Role not found.', 404);
  }

  const member = await getMember(memberUserId, monasterySpaceId);
  if (!member) {
    throw new AppError('Member not found.', 404);
  }

  if (member.isOwner) {
    throw new AppError('Owner member role cannot be changed.', 400);
  }

  const updated = await prisma.monasteryMember.update({
    where: { id: member.id },
    data: { role: request.roleId },
    include: { user: { select: { id: true, name: true, phone: true } } },
  });

  return {
    id: updated.id,
    userId: updated.user.id,
    name: updated.user.name,
    phone: updated.user.phone,
    monasterySpaceId: updated.monasterySpaceId,
    roleId: updated.role,
    roleName: role.name,
    isOwner: updated.isOwner,
  };
};

/**
 * Remove Member from Monastery (matching C# RemoveMember)
 */
export const removeMemberService = async (
  currentUserId: number,
  monasterySpaceId: number,
  memberUserId: number
): Promise<MonasteryMemberDto> => {
  const actor = await getMember(currentUserId, monasterySpaceId);
  if (!(await canManageMonastery(actor))) {
    throw new AppError('User is not authorized to remove monastery members.', 403);
  }

  const member = await getMember(memberUserId, monasterySpaceId);
  if (!member) {
    throw new AppError('Member not found.', 404);
  }

  if (member.isOwner) {
    throw new AppError('Owner member cannot be removed.', 400);
  }

  const user = await prisma.user.findUnique({
    where: { id: memberUserId },
    select: { id: true, name: true, phone: true },
  });
  const role = await prisma.role.findUnique({ where: { id: member.role } });

  await prisma.monasteryMember.delete({ where: { id: member.id } });

  return {
    id: member.id,
    userId: member.userId,
    name: user?.name ?? null,
    phone: user?.phone ?? null,
    monasterySpaceId: member.monasterySpaceId,
    roleId: member.role,
    roleName: role?.name ?? null,
    isOwner: member.isOwner,
  };
};

// Aliases for compatibility
export const createSpaceService = createMonasteryService;
export const updateSpaceService = updateMonasteryService;
export const deleteSpaceService = deleteMonasteryService;
export const getSpaceByIdService = getMonasteryService;
export const getSpacesService = getMyMonasteriesService;
