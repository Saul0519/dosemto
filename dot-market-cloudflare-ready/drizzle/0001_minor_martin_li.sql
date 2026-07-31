CREATE TABLE `shops` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`manager_email` text NOT NULL,
	`webhook_ciphertext` text,
	`webhook_iv` text,
	`tile_price` integer DEFAULT 2000 NOT NULL,
	`day_1_multiplier` integer DEFAULT 1550 NOT NULL,
	`day_2_multiplier` integer DEFAULT 1400 NOT NULL,
	`day_3_multiplier` integer DEFAULT 1300 NOT NULL,
	`day_4_multiplier` integer DEFAULT 1200 NOT NULL,
	`day_5_multiplier` integer DEFAULT 1120 NOT NULL,
	`day_6_multiplier` integer DEFAULT 1060 NOT NULL,
	`day_7_multiplier` integer DEFAULT 1000 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shops_slug_unique` ON `shops` (`slug`);