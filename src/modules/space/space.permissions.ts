export const SPACE_ROLES = {
  SPACE_ADMIN: 4,
  SPACE_MODERATOR: 5,
  SPACE_EDITOR: 6,
  SPACE_MEMBER: 7,
} as const;

export type SpaceRoleId = (typeof SPACE_ROLES)[keyof typeof SPACE_ROLES];

export const SPACE_PERMISSIONS = [
  'Space.View',
  'Space.Settings.Edit',
  'Space.Delete',
  'Space.Member.Invite',
  'Space.Member.Manage',
  'Space.Member.Remove',
  'Space.Role.Manage',
  'Space.Post.Create',
  'Space.Donation.Create',
  'Space.Donation.Review',
] as const;

export type SpacePermission = (typeof SPACE_PERMISSIONS)[number];
