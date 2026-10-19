export const SPACE_PERMISSIONS = [
  'Space.View',
  'Space.Settings.Edit',
  'Space.Delete',
  'Space.Member.Invite',
  'Space.Member.Manage',
  'Space.Role.Manage',
  'Space.Post.Create',
  'Space.Donation.Create',
  'Space.Donation.Review',
] as const;

export type SpacePermission = (typeof SPACE_PERMISSIONS)[number];

export const DEFAULT_SPACE_ROLES = [
  {
    name: 'Space Admin',
    permissions: SPACE_PERMISSIONS.filter(
      (key) => key !== 'Space.Role.Manage' && key !== 'Space.Delete'
    ),
  },
  {
    name: 'Space Editor',
    permissions: ['Space.View', 'Space.Post.Create', 'Space.Donation.Create'],
  },
  { name: 'Space Viewer', permissions: ['Space.View'] },
];
