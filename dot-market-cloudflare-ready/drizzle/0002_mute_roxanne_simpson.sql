CREATE TABLE `shop_images` (
	`id` text PRIMARY KEY NOT NULL,
	`shop_id` text NOT NULL,
	`object_key` text NOT NULL,
	`filename` text NOT NULL,
	`content_type` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shop_images_object_key_unique` ON `shop_images` (`object_key`);--> statement-breakpoint
ALTER TABLE `shops` ADD `about_title` text DEFAULT '작업 안내' NOT NULL;--> statement-breakpoint
ALTER TABLE `shops` ADD `about_text` text DEFAULT '' NOT NULL;