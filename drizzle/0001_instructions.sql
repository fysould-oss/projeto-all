CREATE TABLE office_instructions (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL,
  instruction TEXT,
  instruction_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'claimed', 'completed', 'failed', 'expired')),
  receipt_hash TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX office_instructions_claim ON office_instructions(status, session_id, created_at);
