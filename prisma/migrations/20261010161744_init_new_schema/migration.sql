-- Preserve existing accounts, IDs, credentials, profiles, sessions and donation history.
-- Legacy donation tables remain mapped in schema.prisma: their semantics are
-- different from Donor_List and cannot be converted without a business mapping.
-- This migration must not already have been applied; see migration notes.

CREATE TABLE `Role` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(50) NOT NULL,
    `is_deleted` BOOLEAN NOT NULL DEFAULT false,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Permission` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(50) NOT NULL,
    `is_deleted` BOOLEAN NOT NULL DEFAULT false,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Role_Permission` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `role_id` INTEGER NOT NULL,
    `permission_id` INTEGER NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Monastery_Space` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `monastery_name` VARCHAR(255) NOT NULL,
    `description` VARCHAR(1000) NULL,
    `address` VARCHAR(500) NULL,
    `created_by_id` INTEGER NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Monastery_Member` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `monastery_space_id` INTEGER NOT NULL,
    `role` INTEGER NOT NULL,
    `is_owner` BOOLEAN NOT NULL DEFAULT false,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Donor_List` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `monastery_space_id` INTEGER NOT NULL,
    `donor_id` INTEGER NOT NULL,
    `donor_name` VARCHAR(255) NULL,
    `donation_type` VARCHAR(100) NULL,
    `donation_type_value` INTEGER NOT NULL,
    `custom_donation_type` VARCHAR(255) NULL,
    `note` VARCHAR(1000) NULL,
    `amount` DECIMAL(18, 2) NULL,
    `quantity` DECIMAL(18, 2) NULL,
    `status` VARCHAR(100) NULL,
    `status_value` INTEGER NOT NULL,
    `reviewer_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `reviewed_at` DATETIME(3) NULL,
    `pickup_time` DATETIME(3) NULL,
    `dropoff_time` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Notification` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `type` INTEGER NOT NULL,
    `message` VARCHAR(1000) NULL,
    `is_read` BOOLEAN NOT NULL DEFAULT false,
    `is_deleted` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Invitation` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `monastery_space_id` INTEGER NOT NULL,
    `invited_user_id` INTEGER NOT NULL,
    `invited_by_id` INTEGER NOT NULL,
    `role` INTEGER NOT NULL,
    `status` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `User_Setting` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `pickup_time` DATETIME(3) NULL,
    `dropoff_time` DATETIME(3) NULL,
    `pickup_notification_time` DATETIME(3) NULL,
    `dropoff_notification_time` DATETIME(3) NULL,

    UNIQUE INDEX `User_Setting_user_id_key`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Fixed public role IDs used by registration and existing account conversion.
INSERT INTO `Role` (`id`, `name`) VALUES (1, 'Monk'), (2, 'Donor');

ALTER TABLE `users` ADD COLUMN `role_id` INTEGER NULL;
UPDATE `users`
SET `role_id` = CASE `user_type` WHEN 'Monk' THEN 1 WHEN 'Donor' THEN 2 END;

-- Fail on an unmapped account type rather than discard or guess its role.
ALTER TABLE `users` MODIFY COLUMN `role_id` INTEGER NOT NULL;
DROP INDEX `users_is_deleted_user_type_created_at_idx` ON `users`;
ALTER TABLE `users`
    CHANGE COLUMN `username` `name` VARCHAR(255) NOT NULL,
    CHANGE COLUMN `contactPhone` `contact_phone` VARCHAR(191) NULL,
    MODIFY COLUMN `email` VARCHAR(255) NULL,
    MODIFY COLUMN `password` VARCHAR(255) NOT NULL,
    MODIFY COLUMN `fcm_token` VARCHAR(255) NULL,
    DROP COLUMN `user_type`;
CREATE INDEX `users_is_deleted_user_type_created_at_idx`
ON `users`(`is_deleted`, `role_id`, `created_at` DESC);

ALTER TABLE `monk_profile`
    MODIFY COLUMN `monastery_name` VARCHAR(255) NOT NULL,
    MODIFY COLUMN `monastery_address` VARCHAR(500) NOT NULL;
ALTER TABLE `refresh_tokens`
    MODIFY COLUMN `refresh_token` VARCHAR(512) NOT NULL,
    MODIFY COLUMN `expires_at` DATETIME(3) NULL;

ALTER TABLE `Role_Permission` ADD CONSTRAINT `Role_Permission_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `Role`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `Role_Permission` ADD CONSTRAINT `Role_Permission_permission_id_fkey` FOREIGN KEY (`permission_id`) REFERENCES `Permission`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `users` ADD CONSTRAINT `users_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `Role`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `Monastery_Space` ADD CONSTRAINT `Monastery_Space_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `Monastery_Member` ADD CONSTRAINT `Monastery_Member_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `Monastery_Member` ADD CONSTRAINT `Monastery_Member_monastery_space_id_fkey` FOREIGN KEY (`monastery_space_id`) REFERENCES `Monastery_Space`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `Donor_List` ADD CONSTRAINT `Donor_List_monastery_space_id_fkey` FOREIGN KEY (`monastery_space_id`) REFERENCES `Monastery_Space`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `Donor_List` ADD CONSTRAINT `Donor_List_donor_id_fkey` FOREIGN KEY (`donor_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `Donor_List` ADD CONSTRAINT `Donor_List_reviewer_id_fkey` FOREIGN KEY (`reviewer_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `Notification` ADD CONSTRAINT `Notification_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `Invitation` ADD CONSTRAINT `Invitation_monastery_space_id_fkey` FOREIGN KEY (`monastery_space_id`) REFERENCES `Monastery_Space`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `Invitation` ADD CONSTRAINT `Invitation_invited_user_id_fkey` FOREIGN KEY (`invited_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `Invitation` ADD CONSTRAINT `Invitation_invited_by_id_fkey` FOREIGN KEY (`invited_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `User_Setting` ADD CONSTRAINT `User_Setting_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
