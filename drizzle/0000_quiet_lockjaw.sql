CREATE TABLE `journals` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `photos` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`object_key` text NOT NULL,
	`mime` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `receipts` (
	`owner_id` text NOT NULL,
	`request_id` text NOT NULL,
	`payload_hash` text NOT NULL,
	`report` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `request_id`)
);
--> statement-breakpoint
CREATE TABLE `journal_revisions` (
	`owner_id` text NOT NULL,
	`revision` integer NOT NULL,
	`state` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `revision`)
);
