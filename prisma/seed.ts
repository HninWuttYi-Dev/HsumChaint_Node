import { prisma } from "../src/lib/prisma";
import { logger } from "../src/utils/logger";
import { DONATION_PERMISSIONS } from "../src/modules/space/donation.schema";

export const SYSTEM_ROLES = [
  { id: 1, name: "Monk" },
  { id: 2, name: "Donor" },
  { id: 3, name: "Admin" },
];

export const SPACE_ROLES = [
  { id: 4, name: "Space Admin" },
  { id: 5, name: "Space Moderator" },
  { id: 6, name: "Space Editor" },
  { id: 7, name: "Space Member" },
];

export const ALL_ROLES = [...SYSTEM_ROLES, ...SPACE_ROLES];

export const SYSTEM_PERMISSIONS = [
  ...DONATION_PERMISSIONS,
  // User Management
  "User.View",
  "User.Create",
  "User.Update",
  "User.Delete",

  // Role Management
  "Role.View",
  "Role.Create",
  "Role.Update",
  "Role.Delete",

  // Donor Management
  "Donor.View",
  "Donor.Create",
  "Donor.Update",
  "Donor.Delete",

  // Monastery Spaces (Global)
  "Monastery.View",
  "Monastery.Create",
  "Monastery.Update",
  "Monastery.Delete",
  "Monastery.ManageMembers",
];

export const SPACE_PERMISSIONS = [
  "Space.View",
  "Space.Settings.Edit",
  "Space.Delete",
  "Space.Member.Invite",
  "Space.Member.Manage",
  "Space.Member.Remove",
  "Space.Role.Manage",
  "Space.Post.Create",
  "Space.Donation.Create",
  "Space.Donation.Review",
];

export const ALL_PERMISSIONS = [...SYSTEM_PERMISSIONS, ...SPACE_PERMISSIONS];

async function seedRbac() {
  logger.info("Seeding 3 System Roles and 4 Space Roles...");

  // 1. Seed Roles
  for (const role of ALL_ROLES) {
    await prisma.role.upsert({
      where: { id: role.id },
      update: { name: role.name, isDeleted: false },
      create: { id: role.id, name: role.name, isDeleted: false },
    });
  }

  // 2. Seed Permissions
  const permMap = new Map<string, number>();
  for (const permName of ALL_PERMISSIONS) {
    const existing = await prisma.permission.findFirst({
      where: { name: permName },
    });
    if (existing) {
      if (existing.isDeleted) {
        await prisma.permission.update({
          where: { id: existing.id },
          data: { isDeleted: false },
        });
      }
      permMap.set(permName, existing.id);
    } else {
      const created = await prisma.permission.create({
        data: { name: permName, isDeleted: false },
      });
      permMap.set(permName, created.id);
    }
  }

  // 3. Helper to assign permissions to roles
  const assignPermissions = async (roleId: number, permNames: string[]) => {
    for (const name of permNames) {
      const permissionId = permMap.get(name);
      if (!permissionId) continue;

      const existing = await prisma.rolePermission.findFirst({
        where: { roleId, permissionId },
      });
      if (!existing) {
        await prisma.rolePermission.create({
          data: { roleId, permissionId },
        });
      }
    }
  };

  // 4. Assign System Role Permissions
  // Admin (3): All System & Space Permissions
  await assignPermissions(3, ALL_PERMISSIONS);

  // Monk (1): System permissions for monastery management
  await assignPermissions(1, [
    "User.View",
    "Donor.View",
    "Monastery.View",
    "Monastery.Create",
    "Monastery.Update",
    "Monastery.Delete",
    "Monastery.ManageMembers",
    ...DONATION_PERMISSIONS,
  ]);

  // Donor (2): Read-only view
  await assignPermissions(2, ["User.View", "Donor.View", "Monastery.View", "Donation.View", "Donation.Create", "Donation.Cancel"]);

  // 5. Assign Space Role Permissions
  // Space Admin (4): Full space management
  await assignPermissions(4, [
    ...DONATION_PERMISSIONS,
    "Space.View",
    "Space.Settings.Edit",
    "Space.Member.Invite",
    "Space.Member.Manage",
    "Space.Member.Remove",
    "Space.Role.Manage",
    "Space.Post.Create",
    "Space.Donation.Create",
    "Space.Donation.Review",
  ]);

  // Space Moderator (5)
  await assignPermissions(5, [
    ...DONATION_PERMISSIONS,
    "Space.View",
    "Space.Member.Invite",
    "Space.Post.Create",
    "Space.Donation.Create",
    "Space.Donation.Review",
  ]);

  // Space Editor (6)
  await assignPermissions(6, [
    "Donation.View", "Donation.Create", "Donation.Schedule", "Donation.Cancel",
    "Space.View",
    "Space.Post.Create",
    "Space.Donation.Create",
  ]);

  // Space Member (7)
  await assignPermissions(7, ["Space.View", "Donation.View", "Donation.Create", "Donation.Cancel"]);

  logger.info("RBAC seeding complete: 3 System Roles, 4 Space Roles, and permissions assigned.");
}

async function userSeeder() {
  await seedRbac();

  logger.info("Seeding default users...");
  const password = await Bun.password.hash("password123");

  // Admin user
  await prisma.user.upsert({
    where: { phone: "09999999999" },
    update: { roleId: 3 },
    create: {
      phone: "09999999999",
      name: "SuperAdmin",
      password,
      email: "admin@hsumchaint.org",
      roleId: 3,
    },
  });

  // Default Monk User
  await prisma.user.upsert({
    where: { phone: "09111111111" },
    update: { roleId: 1 },
    create: {
      phone: "09111111111",
      name: "U Thuzana (Monk)",
      password,
      email: "monk@hsumchaint.org",
      roleId: 1,
      monkProfile: {
        create: {
          monasteryName: "Mahasi Sasana Yeiktha",
          monasteryAddress: "Bahan Township, Yangon",
        },
      },
    },
  });

  // Test users
  for (let i = 0; i < 5; i++) {
    const phone = `0912345678${i}`;
    await prisma.user.upsert({
      where: { phone },
      update: {},
      create: {
        phone,
        name: `testUser${i}`,
        password,
        email: `test${i}@gmail.com`,
        roleId: i % 2 === 0 ? 1 : 2,
      },
    });
  }

  logger.info("Seeding finished successfully.");
}

userSeeder()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
