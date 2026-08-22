ALTER TABLE `canvases` ADD `snapshot_updated_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE `canvases` SET `snapshot_updated_at` = `updated_at`;
