CREATE TABLE `embedded_appearance` (
	`user_id` text PRIMARY KEY NOT NULL,
	`theme` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
