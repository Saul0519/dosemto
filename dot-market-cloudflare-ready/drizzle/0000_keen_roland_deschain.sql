CREATE TABLE `price_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`tile_price` integer DEFAULT 2000 NOT NULL,
	`day_1_multiplier` integer DEFAULT 1550 NOT NULL,
	`day_2_multiplier` integer DEFAULT 1400 NOT NULL,
	`day_3_multiplier` integer DEFAULT 1300 NOT NULL,
	`day_4_multiplier` integer DEFAULT 1200 NOT NULL,
	`day_5_multiplier` integer DEFAULT 1120 NOT NULL,
	`day_6_multiplier` integer DEFAULT 1060 NOT NULL,
	`day_7_multiplier` integer DEFAULT 1000 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
