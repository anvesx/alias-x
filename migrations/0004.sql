-- Persist recipient progress without resetting the fencing generation (attempt).
ALTER TABLE deliveries ADD COLUMN recipients TEXT CHECK(recipients IS NULL OR json_valid(recipients));
ALTER TABLE deliveries ADD COLUMN next_recipient INTEGER NOT NULL DEFAULT 0 CHECK(next_recipient>=0);
ALTER TABLE deliveries ADD COLUMN failures INTEGER NOT NULL DEFAULT 0 CHECK(failures>=0);
-- Preserve the retry budget of jobs queued by an older version.
UPDATE deliveries SET failures=CASE
 WHEN status='queued' THEN attempt
 WHEN status='preparing' THEN max(0,attempt-1)
 ELSE 0 END;
