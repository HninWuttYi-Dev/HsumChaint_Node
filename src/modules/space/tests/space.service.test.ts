import { beforeEach, describe, expect, it, mock } from 'bun:test';
import {
  createMonasteryService,
  deleteMonasteryService,
  getMembersService,
  getMonasteryService,
  getMyMonasteriesService,
  inviteMemberService,
  removeMemberService,
  respondToInvitationService,
  updateMemberRoleService,
  updateMonasteryService,
} from '../space.service';

interface MockUser {
  id: number;
  name: string;
  phone: string;
  roleId: number;
  isDeleted: boolean;
}

interface MockSpace {
  id: number;
  monasteryName: string;
  description?: string | null;
  address?: string | null;
  createdById: number;
  isDeleted: boolean;
}

interface MockMember {
  id: number;
  userId: number;
  monasterySpaceId: number;
  role: number;
  isOwner: boolean;
}

interface MockRole {
  id: number;
  name: string;
  isDeleted: boolean;
}

interface MockPermission {
  id: number;
  name: string;
  isDeleted: boolean;
}

interface MockRolePermission {
  id: number;
  roleId: number;
  permissionId: number;
}

interface MockInvitation {
  id: number;
  monasterySpaceId: number;
  invitedUserId: number;
  invitedById: number;
  role: number;
  status: number;
  createdAt: Date;
}

interface MockNotification {
  id: number;
  userId: number;
  type: number;
  message: string;
  isRead: boolean;
  isDeleted: boolean;
}

let mockUsers: MockUser[] = [];
let mockSpaces: MockSpace[] = [];
let mockMembers: MockMember[] = [];
let mockRoles: MockRole[] = [];
let mockPermissions: MockPermission[] = [];
let mockRolePermissions: MockRolePermission[] = [];
let mockInvitations: MockInvitation[] = [];
let mockNotifications: MockNotification[] = [];

mock.module('@/lib/prisma', () => ({
  prisma: {
    user: {
      findFirst: mock(
        async ({ where }: { where: { id?: number; phone?: string; isDeleted?: boolean } }) => {
          const u = mockUsers.find(
            (u) =>
              (!where.id || u.id === where.id) &&
              (!where.phone || u.phone === where.phone) &&
              (!where.isDeleted || !u.isDeleted)
          );
          if (!u) return null;
          return {
            ...u,
            role: mockRoles.find((r) => r.id === u.roleId) ?? null,
          };
        }
      ),
      findUnique: mock(async ({ where }: { where: { id: number } }) => {
        return mockUsers.find((u) => u.id === where.id) ?? null;
      }),
    },
    monasterySpace: {
      create: mock(async ({ data }: { data: Omit<MockSpace, 'id'> }) => {
        const space: MockSpace = {
          id: mockSpaces.length + 1,
          monasteryName: data.monasteryName,
          description: data.description,
          address: data.address,
          createdById: data.createdById,
          isDeleted: false,
        };
        mockSpaces.push(space);
        return space;
      }),
      findMany: mock(async () => mockSpaces.filter((s) => !s.isDeleted)),
      findUnique: mock(async ({ where }: { where: { id: number } }) => {
        return mockSpaces.find((s) => s.id === where.id && !s.isDeleted) ?? null;
      }),
      findFirst: mock(async ({ where }: { where: { id: number; isDeleted?: boolean } }) => {
        return (
          mockSpaces.find(
            (s) =>
              s.id === where.id &&
              (where.isDeleted === undefined || s.isDeleted === where.isDeleted)
          ) ?? null
        );
      }),
      update: mock(async ({ where, data }: { where: { id: number }; data: Partial<MockSpace> }) => {
        const space = mockSpaces.find((s) => s.id === where.id);
        if (!space) throw new Error('Not found');
        Object.assign(space, data);
        return space;
      }),
      delete: mock(async ({ where }: { where: { id: number } }) => {
        const index = mockSpaces.findIndex((s) => s.id === where.id);
        if (index === -1) throw new Error('Not found');
        return mockSpaces.splice(index, 1)[0];
      }),
      count: mock(async () => mockSpaces.filter((s) => !s.isDeleted).length),
    },
    monasteryMember: {
      create: mock(async ({ data }: { data: Omit<MockMember, 'id'> }) => {
        const member: MockMember = {
          id: mockMembers.length + 1,
          userId: data.userId,
          monasterySpaceId: data.monasterySpaceId,
          role: data.role,
          isOwner: data.isOwner,
        };
        mockMembers.push(member);
        return member;
      }),
      findFirst: mock(
        async ({
          where,
        }: {
          where: { userId?: number; monasterySpaceId?: number; role?: number };
        }) => {
          return (
            mockMembers.find(
              (m) =>
                (where.userId === undefined || m.userId === where.userId) &&
                (where.monasterySpaceId === undefined ||
                  m.monasterySpaceId === where.monasterySpaceId) &&
                (where.role === undefined || m.role === where.role)
            ) ?? null
          );
        }
      ),
      findMany: mock(
        async ({ where }: { where: { userId?: number; monasterySpaceId?: number } }) => {
          return mockMembers
            .filter(
              (m) =>
                (where.userId === undefined || m.userId === where.userId) &&
                (where.monasterySpaceId === undefined ||
                  m.monasterySpaceId === where.monasterySpaceId)
            )
            .map((m) => ({
              ...m,
              user: mockUsers.find((u) => u.id === m.userId),
              monasterySpace: mockSpaces.find((s) => s.id === m.monasterySpaceId),
            }));
        }
      ),
      update: mock(
        async ({ where, data }: { where: { id: number }; data: Partial<MockMember> }) => {
          const member = mockMembers.find((m) => m.id === where.id);
          if (!member) throw new Error('Not found');
          Object.assign(member, data);
          return {
            ...member,
            user: mockUsers.find((u) => u.id === member.userId),
          };
        }
      ),
      delete: mock(async ({ where }: { where: { id: number } }) => {
        const index = mockMembers.findIndex((m) => m.id === where.id);
        if (index === -1) throw new Error('Not found');
        return mockMembers.splice(index, 1)[0];
      }),
      deleteMany: mock(async ({ where }: { where: { monasterySpaceId?: number } }) => {
        const init = mockMembers.length;
        mockMembers = mockMembers.filter(
          (m) => !where.monasterySpaceId || m.monasterySpaceId !== where.monasterySpaceId
        );
        return { count: init - mockMembers.length };
      }),
      count: mock(
        async ({
          where,
        }: {
          where?: { userId?: number; monasterySpaceId?: number; role?: number };
        }) => {
          return mockMembers.filter(
            (m) =>
              (!where?.userId || m.userId === where.userId) &&
              (!where?.monasterySpaceId || m.monasterySpaceId === where.monasterySpaceId) &&
              (!where?.role || m.role === where.role)
          ).length;
        }
      ),
    },
    role: {
      findMany: mock(
        async ({ where }: { where?: { id?: { in?: number[] }; isDeleted?: boolean } }) => {
          return mockRoles.filter(
            (r) =>
              (!where?.isDeleted || !r.isDeleted) && (!where?.id?.in || where.id.in.includes(r.id))
          );
        }
      ),
      findFirst: mock(
        async ({ where }: { where: { id?: number; name?: string; isDeleted?: boolean } }) => {
          return (
            mockRoles.find(
              (r) =>
                (!where.id || r.id === where.id) &&
                (!where.name || r.name.toLowerCase() === where.name.toLowerCase()) &&
                (!where.isDeleted || !r.isDeleted)
            ) ?? null
          );
        }
      ),
      findUnique: mock(async ({ where }: { where: { id: number } }) => {
        return mockRoles.find((r) => r.id === where.id) ?? null;
      }),
    },
    rolePermission: {
      count: mock(
        async ({
          where,
        }: {
          where: {
            roleId?: number;
            permission?: { name?: { in?: string[] }; isDeleted?: boolean };
          };
        }) => {
          return mockRolePermissions.filter((rp) => {
            if (where.roleId && rp.roleId !== where.roleId) return false;
            const perm = mockPermissions.find((p) => p.id === rp.permissionId);
            if (!perm || perm.isDeleted) return false;
            if (where.permission?.name?.in && !where.permission.name.in.includes(perm.name))
              return false;
            return true;
          }).length;
        }
      ),
      findMany: mock(async () => mockRolePermissions),
    },
    invitation: {
      create: mock(async ({ data }: { data: Omit<MockInvitation, 'id' | 'createdAt'> }) => {
        const inv: MockInvitation = {
          id: mockInvitations.length + 1,
          monasterySpaceId: data.monasterySpaceId,
          invitedUserId: data.invitedUserId,
          invitedById: data.invitedById,
          role: data.role,
          status: data.status,
          createdAt: new Date(),
        };
        mockInvitations.push(inv);
        return inv;
      }),
      findFirst: mock(
        async ({
          where,
        }: {
          where: {
            monasterySpaceId?: number;
            invitedUserId?: number;
            role?: number;
            status?: number;
          };
        }) => {
          return (
            mockInvitations.find(
              (i) =>
                (where.monasterySpaceId === undefined ||
                  i.monasterySpaceId === where.monasterySpaceId) &&
                (where.invitedUserId === undefined || i.invitedUserId === where.invitedUserId) &&
                (where.role === undefined || i.role === where.role) &&
                (where.status === undefined || i.status === where.status)
            ) ?? null
          );
        }
      ),
      findUnique: mock(async ({ where }: { where: { id: number } }) => {
        return mockInvitations.find((i) => i.id === where.id) ?? null;
      }),
      update: mock(
        async ({ where, data }: { where: { id: number }; data: Partial<MockInvitation> }) => {
          const inv = mockInvitations.find((i) => i.id === where.id);
          if (!inv) throw new Error('Not found');
          Object.assign(inv, data);
          return inv;
        }
      ),
      deleteMany: mock(async ({ where }: { where: { monasterySpaceId?: number } }) => {
        const init = mockInvitations.length;
        mockInvitations = mockInvitations.filter(
          (i) => !where.monasterySpaceId || i.monasterySpaceId !== where.monasterySpaceId
        );
        return { count: init - mockInvitations.length };
      }),
    },
    notification: {
      create: mock(async ({ data }: { data: Omit<MockNotification, 'id'> }) => {
        const notif: MockNotification = {
          id: mockNotifications.length + 1,
          userId: data.userId,
          type: data.type,
          message: data.message,
          isRead: data.isRead ?? false,
          isDeleted: data.isDeleted ?? false,
        };
        mockNotifications.push(notif);
        return notif;
      }),
    },
    $transaction: mock(async (callback: (tx: unknown) => Promise<unknown>) => {
      const { prisma } = await import('@/lib/prisma');
      return await callback(prisma);
    }),
  },
}));

describe('Monastery Service Unit Tests (matching C# HsumChaint)', () => {
  beforeEach(() => {
    mockRoles = [
      { id: 1, name: 'Monk', isDeleted: false },
      { id: 2, name: 'Donor', isDeleted: false },
      { id: 3, name: 'Admin', isDeleted: false },
      { id: 4, name: 'Space Admin', isDeleted: false },
      { id: 5, name: 'Space Moderator', isDeleted: false },
      { id: 6, name: 'Space Editor', isDeleted: false },
      { id: 7, name: 'Space Member', isDeleted: false },
    ];

    mockPermissions = [
      { id: 1, name: 'Monastery.View', isDeleted: false },
      { id: 2, name: 'Monastery.Create', isDeleted: false },
      { id: 3, name: 'Monastery.Update', isDeleted: false },
      { id: 4, name: 'Monastery.Delete', isDeleted: false },
      { id: 5, name: 'Monastery.ManageMembers', isDeleted: false },
      { id: 6, name: 'Space.Member.Manage', isDeleted: false },
    ];

    mockRolePermissions = [
      // Monk has manage members and delete
      { id: 1, roleId: 1, permissionId: 4 },
      { id: 2, roleId: 1, permissionId: 5 },
      // Space Admin has manage members
      { id: 3, roleId: 4, permissionId: 6 },
    ];

    mockUsers = [
      { id: 1, name: 'Sayadaw U Thila', phone: '09111111111', roleId: 1, isDeleted: false },
      { id: 2, name: 'Donor Ko Min', phone: '09222222222', roleId: 2, isDeleted: false },
      { id: 3, name: 'U Zaw', phone: '09333333333', roleId: 2, isDeleted: false },
      { id: 4, name: 'Admin User', phone: '09444444444', roleId: 3, isDeleted: false },
    ];

    mockSpaces = [];
    mockMembers = [];
    mockInvitations = [];
    mockNotifications = [];
  });

  describe('CreateMonastery', () => {
    it('should create monastery and add creator as owner', async () => {
      const space = await createMonasteryService(1, {
        monasteryName: 'Maha Gandhayon',
        description: 'Historic Monastery in Amarapura',
        address: 'Amarapura, Mandalay',
      });

      expect(space.monasteryName).toBe('Maha Gandhayon');
      expect(space.createdById).toBe(1);
      expect(space.currentUserRoleId).toBe(1);
      expect(space.isOwner).toBe(true);

      expect(mockSpaces.length).toBe(1);
      expect(mockMembers.length).toBe(1);
      expect(mockMembers[0].isOwner).toBe(true);
      expect(mockMembers[0].role).toBe(1);
    });

    it('should reject creation without monastery name', async () => {
      expect(
        createMonasteryService(1, {
          monasteryName: '',
        })
      ).rejects.toThrow('Monastery name is required.');
    });
  });

  describe('UpdateMonastery & DeleteMonastery', () => {
    it('should update monastery details by authorized owner', async () => {
      const space = await createMonasteryService(1, { monasteryName: 'Initial Name' });

      const updated = await updateMonasteryService(1, space.id, {
        monasteryName: 'Updated Name',
        description: 'New Description',
      });

      expect(updated.monasteryName).toBe('Updated Name');
      expect(updated.description).toBe('New Description');
    });

    it('should delete monastery if authorized monk owner', async () => {
      const space = await createMonasteryService(1, { monasteryName: 'To Delete' });
      const result = await deleteMonasteryService(1, space.id);

      expect(result.message).toBe('Monastery deleted successfully.');
      expect(mockSpaces.find((s) => s.id === space.id)?.isDeleted).toBe(true);
    });

    it('should reject deletion if not owner monk with delete permission', async () => {
      const space = await createMonasteryService(1, { monasteryName: 'To Delete' });
      expect(deleteMonasteryService(2, space.id)).rejects.toThrow(
        'User is not authorized to delete this monastery.'
      );
    });
  });

  describe('GetMonastery & GetMyMonasteries', () => {
    it('should retrieve monastery details for member', async () => {
      const space = await createMonasteryService(1, { monasteryName: 'Monastery A' });
      const retrieved = await getMonasteryService(1, space.id);

      expect(retrieved.id).toBe(space.id);
      expect(retrieved.monasteryName).toBe('Monastery A');
    });

    it('should reject retrieval for non-member', async () => {
      const space = await createMonasteryService(1, { monasteryName: 'Monastery A' });
      expect(getMonasteryService(2, space.id)).rejects.toThrow(
        'User is not a member of this monastery.'
      );
    });

    it('should allow System Admin to view any monastery without being a member', async () => {
      const space = await createMonasteryService(1, { monasteryName: 'Monastery A' });
      const retrieved = await getMonasteryService(4, space.id, 3);

      expect(retrieved.id).toBe(space.id);
      expect(retrieved.monasteryName).toBe('Monastery A');
      expect(retrieved.currentUserRoleName).toBe('Admin');
      expect(retrieved.isOwner).toBe(false);
    });

    it('should retrieve list of monasteries the user is member of', async () => {
      await createMonasteryService(1, { monasteryName: 'Monastery 1' });
      await createMonasteryService(1, { monasteryName: 'Monastery 2' });

      const result = await getMyMonasteriesService(1, { page: 1, limit: 10 });
      expect(result.items.length).toBe(2);
      expect(result.total).toBe(2);
    });

    it('should allow System Admin to list all monasteries even if not a member of them', async () => {
      await createMonasteryService(1, { monasteryName: 'Monastery 1' });
      await createMonasteryService(1, { monasteryName: 'Monastery 2' });

      const result = await getMyMonasteriesService(4, { page: 1, limit: 10 }, 3);
      expect(result.items.length).toBe(2);
      expect(result.total).toBe(2);
    });
  });

  describe('InviteMember & RespondToInvitation', () => {
    it('should create an invitation and send a notification', async () => {
      const space = await createMonasteryService(1, { monasteryName: 'Monastery Invite' });

      const invitation = await inviteMemberService(1, space.id, {
        roleId: 7, // Space Member
        userId: 2,
      });

      expect(invitation.status).toBe(0); // Pending
      expect(invitation.roleId).toBe(7);
      expect(mockInvitations.length).toBe(1);
      expect(mockNotifications.length).toBe(1);
      expect(mockNotifications[0].userId).toBe(2);
      expect(mockNotifications[0].message).toBe('You have a new monastery invitation.');
    });

    it('should reject inviting self', async () => {
      const space = await createMonasteryService(1, { monasteryName: 'Monastery Invite' });

      expect(
        inviteMemberService(1, space.id, {
          roleId: 7,
          userId: 1,
        })
      ).rejects.toThrow('User cannot invite themselves.');
    });

    it('should reject inviting existing member', async () => {
      const space = await createMonasteryService(1, { monasteryName: 'Monastery Invite' });
      mockMembers.push({
        id: 99,
        userId: 2,
        monasterySpaceId: space.id,
        role: 7,
        isOwner: false,
      });

      expect(
        inviteMemberService(1, space.id, {
          roleId: 7,
          userId: 2,
        })
      ).rejects.toThrow('User is already a monastery member.');
    });

    it('should allow user to accept invitation and become member', async () => {
      const space = await createMonasteryService(1, { monasteryName: 'Monastery Invite' });
      const invitation = await inviteMemberService(1, space.id, {
        roleId: 7,
        userId: 2,
      });

      const response = await respondToInvitationService(2, invitation.invitationId, {
        status: 1, // Accept
      });

      expect(response.status).toBe(1);
      expect(mockMembers.some((m) => m.userId === 2 && m.monasterySpaceId === space.id)).toBe(true);
    });

    it('should allow user to reject invitation', async () => {
      const space = await createMonasteryService(1, { monasteryName: 'Monastery Invite' });
      const invitation = await inviteMemberService(1, space.id, {
        roleId: 7,
        userId: 2,
      });

      const response = await respondToInvitationService(2, invitation.invitationId, {
        status: 2, // Reject
      });

      expect(response.status).toBe(2);
      expect(mockMembers.some((m) => m.userId === 2 && m.monasterySpaceId === space.id)).toBe(
        false
      );
    });
  });

  describe('Member Management (getMembers, updateMemberRole, removeMember)', () => {
    it('should list all members of the monastery', async () => {
      const space = await createMonasteryService(1, { monasteryName: 'Monastery Members' });
      const result = await getMembersService(1, space.id, { page: 1, limit: 10 });

      expect(result.items.length).toBe(1);
      expect(result.items[0].name).toBe('Sayadaw U Thila');
      expect(result.items[0].isOwner).toBe(true);
    });

    it('should allow System Admin to view members of any space without being a member', async () => {
      const space = await createMonasteryService(1, { monasteryName: 'Monastery Members' });
      const result = await getMembersService(4, space.id, { page: 1, limit: 10 }, 3);

      expect(result.items.length).toBe(1);
      expect(result.items[0].name).toBe('Sayadaw U Thila');
    });

    it('should update member role (except owner)', async () => {
      const space = await createMonasteryService(1, { monasteryName: 'Monastery Roles' });
      mockMembers.push({
        id: 2,
        userId: 2,
        monasterySpaceId: space.id,
        role: 7,
        isOwner: false,
      });

      const updated = await updateMemberRoleService(1, space.id, 2, { roleId: 5 });
      expect(updated.roleId).toBe(5);
    });

    it('should prevent modifying owner role', async () => {
      const space = await createMonasteryService(1, { monasteryName: 'Monastery Roles' });
      expect(updateMemberRoleService(1, space.id, 1, { roleId: 5 })).rejects.toThrow(
        'Owner member role cannot be changed.'
      );
    });

    it('should remove a member from the monastery', async () => {
      const space = await createMonasteryService(1, { monasteryName: 'Monastery Remove' });
      mockMembers.push({
        id: 2,
        userId: 2,
        monasterySpaceId: space.id,
        role: 7,
        isOwner: false,
      });

      const removed = await removeMemberService(1, space.id, 2);
      expect(removed.userId).toBe(2);
      expect(mockMembers.some((m) => m.userId === 2)).toBe(false);
    });

    it('should prevent removing the owner', async () => {
      const space = await createMonasteryService(1, { monasteryName: 'Monastery Remove' });
      expect(removeMemberService(1, space.id, 1)).rejects.toThrow(
        'Owner member cannot be removed.'
      );
    });
  });
});
