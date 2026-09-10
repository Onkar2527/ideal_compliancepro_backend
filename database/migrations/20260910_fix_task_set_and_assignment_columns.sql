-- =============================================================================
-- Migration: Add missing columns for task_set, assignment, and related tables
-- Safe & Idempotent: Uses IF NOT EXISTS clauses so it can be safely re-run.
-- =============================================================================

BEGIN;

-- 1. Ensure task_set columns exist
ALTER TABLE task_set
  ADD COLUMN IF NOT EXISTS circular_id              INTEGER REFERENCES circular(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS start_date               DATE,
  ADD COLUMN IF NOT EXISTS end_date                 DATE,
  ADD COLUMN IF NOT EXISTS frequency                VARCHAR(50),
  ADD COLUMN IF NOT EXISTS reporting_date           DATE,
  ADD COLUMN IF NOT EXISTS type                     VARCHAR(50) DEFAULT 'REGULAR',
  ADD COLUMN IF NOT EXISTS authority_id             INTEGER REFERENCES authority(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reference_no             VARCHAR(255),
  ADD COLUMN IF NOT EXISTS assignment_time          VARCHAR(20),
  ADD COLUMN IF NOT EXISTS reporting_time           VARCHAR(20),
  ADD COLUMN IF NOT EXISTS due_time                 VARCHAR(20),
  ADD COLUMN IF NOT EXISTS assignment_day_of_week   INTEGER,
  ADD COLUMN IF NOT EXISTS reporting_day_of_week    INTEGER,
  ADD COLUMN IF NOT EXISTS due_day_of_week          INTEGER,
  ADD COLUMN IF NOT EXISTS assignment_days_of_month VARCHAR(255),
  ADD COLUMN IF NOT EXISTS reporting_days_of_month  VARCHAR(255),
  ADD COLUMN IF NOT EXISTS due_days_of_month        VARCHAR(255),
  ADD COLUMN IF NOT EXISTS assignment_schedule      VARCHAR(255),
  ADD COLUMN IF NOT EXISTS reporting_schedule       VARCHAR(255),
  ADD COLUMN IF NOT EXISTS due_schedule             VARCHAR(255),
  ADD COLUMN IF NOT EXISTS day_of_week              INTEGER,
  ADD COLUMN IF NOT EXISTS days_of_month            TEXT,
  ADD COLUMN IF NOT EXISTS schedule_day             INTEGER,
  ADD COLUMN IF NOT EXISTS schedule_month           INTEGER,
  ADD COLUMN IF NOT EXISTS created_at               TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS updated_at               TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- 2. Ensure task_set_branch table exists
CREATE TABLE IF NOT EXISTS task_set_branch (
  task_set_id INTEGER REFERENCES task_set(id) ON DELETE CASCADE,
  branch_id INTEGER REFERENCES branch_dept(id) ON DELETE CASCADE,
  PRIMARY KEY (task_set_id, branch_id)
);

-- 3. Ensure task_set_mapping columns exist
ALTER TABLE task_set_mapping
  ADD COLUMN IF NOT EXISTS due_date DATE;

-- 4. Ensure assignment table columns exist
ALTER TABLE assignment
  ADD COLUMN IF NOT EXISTS timeline_remark  TEXT,
  ADD COLUMN IF NOT EXISTS created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- 5. Ensure assignment_task table columns exist
ALTER TABLE assignment_task
  ADD COLUMN IF NOT EXISTS due_date                 DATE,
  ADD COLUMN IF NOT EXISTS proposed_due_date        DATE,
  ADD COLUMN IF NOT EXISTS proposed_remark          TEXT,
  ADD COLUMN IF NOT EXISTS timeline_review_remark   TEXT;

COMMIT;
