CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`shop_id` text NOT NULL,
	`contact` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`grid_x` integer NOT NULL,
	`grid_y` integer NOT NULL,
	`tile_count` integer NOT NULL,
	`deadline` integer NOT NULL,
	`total_price` integer NOT NULL,
	`crop_label` text NOT NULL,
	`original_filename` text NOT NULL,
	`preview_object_key` text NOT NULL,
	`preview_content_type` text DEFAULT 'image/png' NOT NULL,
	`original_object_key` text,
	`original_content_type` text,
	`status` text DEFAULT 'new' NOT NULL,
	`webhook_sent` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_preview_object_key_unique` ON `orders` (`preview_object_key`);