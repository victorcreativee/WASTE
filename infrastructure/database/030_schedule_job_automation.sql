ALTER TABLE collection_jobs ADD COLUMN IF NOT EXISTS schedule_occurrence_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS collection_jobs_new_occurrence_unique
  ON collection_jobs(schedule_occurrence_key)
  WHERE schedule_occurrence_key IS NOT NULL;
