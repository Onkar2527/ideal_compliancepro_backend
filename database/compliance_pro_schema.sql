-- Compliance Pro Core Schema
CREATE EXTENSION IF NOT EXISTS vector;

DROP TABLE IF EXISTS evidence CASCADE;
DROP TABLE IF EXISTS assignment CASCADE;
DROP TABLE IF EXISTS assignment_task CASCADE;
DROP TABLE IF EXISTS notification CASCADE;
DROP TABLE IF EXISTS task_set_mapping CASCADE;
DROP TABLE IF EXISTS task_set CASCADE;
DROP TABLE IF EXISTS compliance_task CASCADE;
DROP TABLE IF EXISTS circular_file CASCADE;
DROP TABLE IF EXISTS circular CASCADE;
DROP TABLE IF EXISTS authority CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS branch_dept CASCADE;

CREATE TABLE IF NOT EXISTS branch_dept (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(50) NOT NULL -- 'BRANCH', 'DEPARTMENT'
);

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(255) PRIMARY KEY,
  username VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255),
  email VARCHAR(255),
  mobile_number VARCHAR(50),
  role VARCHAR(50) NOT NULL, -- 'ADMIN', 'CCO', 'CO', 'BRANCH_USER'
  branch_id INTEGER REFERENCES branch_dept(id),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS authority (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
CREATE TABLE IF NOT EXISTS circular_category (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) UNIQUE NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS circular (
  id SERIAL PRIMARY KEY,
  authority_id INTEGER REFERENCES authority(id) ON DELETE CASCADE,
  reference_no VARCHAR(255),
  title VARCHAR(500) NOT NULL,
  published_date DATE,
  priority VARCHAR(20) DEFAULT 'General',
  circular_type INTEGER DEFAULT 6,
  category VARCHAR(255),
  description TEXT,
  portal_website VARCHAR(500),
  is_penalty_applicable BOOLEAN DEFAULT false,
  penalty_amount NUMERIC(14,2),
  penalty_description TEXT,
  pdf_url VARCHAR(500)
);

CREATE TABLE IF NOT EXISTS circular_file (
  id SERIAL PRIMARY KEY,
  circular_id INTEGER REFERENCES circular(id) ON DELETE CASCADE,
  file_name VARCHAR(500) NOT NULL,
  file_url VARCHAR(500) NOT NULL,
  mime_type VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS compliance_task (
  id SERIAL PRIMARY KEY,
  circular_id INTEGER REFERENCES circular(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
  is_approved BOOLEAN NOT NULL DEFAULT false,
  is_discarded BOOLEAN DEFAULT false,
  parent_task_id INTEGER REFERENCES compliance_task(id) ON DELETE SET NULL,
  header_id INTEGER REFERENCES task_header(id) ON DELETE SET NULL,
  priority VARCHAR(50),
  risk_category VARCHAR(100),
  business_risk TEXT,
  control_risk TEXT,
  audit_area_id INTEGER,
  file_url TEXT,
  embedding vector(768),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS task_set (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  circular_id INTEGER REFERENCES circular(id) ON DELETE SET NULL,
  default_due_date DATE,
  start_date DATE,
  end_date DATE,
  frequency VARCHAR(50),
  reporting_date DATE,
  type VARCHAR(50) DEFAULT 'REGULAR',
  authority_id INTEGER REFERENCES authority(id) ON DELETE SET NULL,
  reference_no VARCHAR(255),
  assignment_time VARCHAR(20),
  reporting_time VARCHAR(20),
  due_time VARCHAR(20),
  assignment_day_of_week INTEGER,
  reporting_day_of_week INTEGER,
  due_day_of_week INTEGER,
  assignment_days_of_month VARCHAR(255),
  reporting_days_of_month VARCHAR(255),
  due_days_of_month VARCHAR(255),
  assignment_schedule VARCHAR(255),
  reporting_schedule VARCHAR(255),
  due_schedule VARCHAR(255),
  day_of_week INTEGER,
  days_of_month TEXT,
  schedule_day INTEGER,
  schedule_month INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS task_set_mapping (
  task_set_id INTEGER REFERENCES task_set(id) ON DELETE CASCADE,
  task_id INTEGER REFERENCES compliance_task(id) ON DELETE CASCADE,
  due_date DATE,
  PRIMARY KEY (task_set_id, task_id)
);

CREATE TABLE IF NOT EXISTS task_set_branch (
  task_set_id INTEGER REFERENCES task_set(id) ON DELETE CASCADE,
  branch_id INTEGER REFERENCES branch_dept(id) ON DELETE CASCADE,
  PRIMARY KEY (task_set_id, branch_id)
);

CREATE TABLE IF NOT EXISTS assignment (
  id SERIAL PRIMARY KEY,
  task_set_id INTEGER REFERENCES task_set(id) ON DELETE CASCADE,
  branch_id INTEGER REFERENCES branch_dept(id) ON DELETE CASCADE,
  proposed_timeline DATE,
  status VARCHAR(50), -- 'DRAFT', 'PENDING_TIMELINE', 'TIMELINE_APPROVED', 'CO_REVIEWING_TIMELINE', 'IN_PROGRESS', 'REVIEW_PENDING', 'COMPLETED', 'REJECTED'
  review_remark TEXT,
  timeline_remark TEXT,
  reviewed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS assignment_task (
  id SERIAL PRIMARY KEY,
  assignment_id INTEGER REFERENCES assignment(id) ON DELETE CASCADE,
  task_id INTEGER REFERENCES compliance_task(id) ON DELETE CASCADE,
  status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (assignment_id, task_id)
);

CREATE TABLE IF NOT EXISTS evidence (
  id SERIAL PRIMARY KEY,
  assignment_task_id INTEGER REFERENCES assignment_task(id) ON DELETE CASCADE,
  assignment_id INTEGER REFERENCES assignment(id) ON DELETE CASCADE,
  file_url VARCHAR(500),
  remark TEXT,
  submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notification (
  id SERIAL PRIMARY KEY,
  branch_id INTEGER REFERENCES branch_dept(id) ON DELETE CASCADE,
  user_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert dummy Admin User
INSERT INTO users (id, username, password_hash, full_name, role)
VALUES ('admin-id-123', 'admin', '$2b$10$EPD4p.yL.T/8yKowV0dGWeM2g.XoV/D/F5L0v/JpXlC5B8rP9k4.K', 'Administrator', 'ADMIN')
ON CONFLICT (username) DO NOTHING;
