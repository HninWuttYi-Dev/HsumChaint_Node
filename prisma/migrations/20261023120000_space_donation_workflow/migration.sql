-- Manual donations may name an offline donor without inventing a login account.
-- Keep the existing foreign key and all existing rows/IDs unchanged.
ALTER TABLE `Donor_List` MODIFY `donor_id` INTEGER NULL;

INSERT INTO `Permission` (`name`, `is_deleted`) VALUES
  ('Donation.View', false), ('Donation.Create', false),
  ('Donation.Review', false), ('Donation.Schedule', false),
  ('Donation.Cancel', false), ('Donation.Delete', false)
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);

-- Node role IDs: Monk=1, Donor=2, Admin=3, Space Admin=4,
-- Space Moderator=5, Space Editor=6, Space Member=7.
-- Keep review separate from scheduling for custom roles and space editors.
INSERT IGNORE INTO `Role_Permission` (`role_id`, `permission_id`)
SELECT r.`id`, p.`id` FROM `Role` r CROSS JOIN `Permission` p
WHERE p.`name` IN ('Donation.View', 'Donation.Create', 'Donation.Review',
  'Donation.Schedule', 'Donation.Cancel', 'Donation.Delete')
AND (
  r.`id` IN (1, 3, 4, 5)
  OR (r.`id` IN (2, 7) AND p.`name` IN ('Donation.View', 'Donation.Create', 'Donation.Cancel'))
  OR (r.`id` = 6 AND p.`name` IN ('Donation.View', 'Donation.Create', 'Donation.Schedule', 'Donation.Cancel'))
);
