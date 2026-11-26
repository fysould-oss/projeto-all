ALTER TABLE office_instructions ADD COLUMN progress TEXT;
--> statement-breakpoint
ALTER TABLE office_instructions ADD COLUMN mode TEXT NOT NULL DEFAULT 'resume';
--> statement-breakpoint
ALTER TABLE office_instructions ADD COLUMN check_status TEXT;
--> statement-breakpoint
ALTER TABLE office_instructions ADD COLUMN test_summary TEXT;
