ALTER TABLE students DROP CONSTRAINT students_status_check;
ALTER TABLE students ADD CONSTRAINT students_status_check CHECK (status IN ('active', 'inactive', 'demo'));

ALTER TABLE courses ALTER COLUMN curriculum_year DROP NOT NULL;
ALTER TABLE lessons ALTER COLUMN duration_display DROP NOT NULL;

CREATE TABLE student_curricula (
  id varchar(200) PRIMARY KEY,
  student_id varchar(100) NOT NULL REFERENCES students(id),
  subject_code varchar(100) NOT NULL,
  title varchar(500) NOT NULL,
  status varchar(20) NOT NULL CHECK (status IN ('candidate', 'active', 'completed', 'archived')),
  current_version_id varchar(200),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  state_json jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX student_curricula_active_subject_key
  ON student_curricula(student_id, subject_code) WHERE status = 'active';
CREATE INDEX student_curricula_student_id_idx ON student_curricula(student_id);

CREATE TABLE curriculum_versions (
  id varchar(200) PRIMARY KEY,
  student_curriculum_id varchar(200) NOT NULL REFERENCES student_curricula(id),
  version_number integer NOT NULL CHECK (version_number >= 1),
  change_reason varchar(50) NOT NULL CHECK (change_reason IN ('initial', 'progress_adjustment', 'remediation', 'teacher_adjustment')),
  change_summary text,
  created_at timestamptz NOT NULL,
  UNIQUE (student_curriculum_id, version_number)
);

ALTER TABLE student_curricula
  ADD CONSTRAINT student_curricula_current_version_id_fkey
  FOREIGN KEY (current_version_id) REFERENCES curriculum_versions(id);

CREATE TABLE curriculum_steps (
  id varchar(200) PRIMARY KEY,
  curriculum_version_id varchar(200) NOT NULL REFERENCES curriculum_versions(id),
  sequence integer NOT NULL CHECK (sequence >= 0),
  title varchar(500) NOT NULL,
  goal text,
  concept_tags jsonb NOT NULL,
  estimated_minutes integer NOT NULL CHECK (estimated_minutes >= 0),
  UNIQUE (curriculum_version_id, sequence)
);

CREATE TABLE curriculum_items (
  id varchar(200) PRIMARY KEY,
  curriculum_step_id varchar(200) NOT NULL REFERENCES curriculum_steps(id),
  sequence integer NOT NULL CHECK (sequence >= 0),
  kind varchar(20) NOT NULL CHECK (kind IN ('lecture', 'review', 'practice', 'check')),
  lesson_id varchar(200) REFERENCES lessons(id),
  title varchar(500) NOT NULL,
  description text,
  concept_tags jsonb NOT NULL,
  estimated_minutes integer NOT NULL CHECK (estimated_minutes >= 0),
  required boolean NOT NULL,
  reason text,
  UNIQUE (curriculum_step_id, sequence),
  CHECK (kind <> 'lecture' OR lesson_id IS NOT NULL)
);
