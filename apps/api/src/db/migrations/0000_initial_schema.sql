CREATE TABLE students (
  id varchar(100) PRIMARY KEY,
  display_name varchar(100),
  status varchar(20) NOT NULL CHECK (status IN ('active', 'inactive')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE courses (
  id varchar(200) PRIMARY KEY,
  provider_id varchar(100) NOT NULL,
  provider_name varchar(200) NOT NULL,
  instructor_id varchar(100) NOT NULL,
  instructor_name varchar(200) NOT NULL,
  title varchar(500) NOT NULL,
  primary_subject varchar(100) NOT NULL,
  included_subjects jsonb NOT NULL,
  curriculum_year integer NOT NULL,
  lesson_count integer NOT NULL CHECK (lesson_count >= 0),
  orientation_count integer NOT NULL CHECK (orientation_count >= 0),
  content_lesson_count integer NOT NULL CHECK (content_lesson_count >= 0),
  total_duration_seconds integer NOT NULL CHECK (total_duration_seconds >= 0),
  source_url text,
  status varchar(30) NOT NULL CHECK (status = 'metadata_only'),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE lessons (
  id varchar(200) PRIMARY KEY,
  course_id varchar(200) NOT NULL REFERENCES courses(id),
  sequence integer NOT NULL CHECK (sequence >= 0),
  lecture_number integer,
  title varchar(500) NOT NULL,
  lesson_type varchar(30) NOT NULL CHECK (lesson_type IN ('orientation', 'lecture', 'mock_exam')),
  subject_areas jsonb NOT NULL,
  unit_names jsonb NOT NULL,
  duration_display varchar(50) NOT NULL,
  duration_seconds integer NOT NULL CHECK (duration_seconds >= 0),
  source_url text,
  playback_target_id varchar(200),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (course_id, sequence)
);
CREATE INDEX lessons_course_id_idx ON lessons(course_id);
CREATE INDEX lessons_course_lesson_type_idx ON lessons(course_id, lesson_type);

CREATE TABLE student_learning_states (
  student_id varchar(100) PRIMARY KEY REFERENCES students(id),
  revision integer NOT NULL CHECK (revision >= 0),
  state_json jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE lesson_feedback_events (
  id uuid PRIMARY KEY,
  student_id varchar(100) NOT NULL REFERENCES students(id),
  lesson_item_id varchar(200) NOT NULL,
  understanding_level integer NOT NULL CHECK (understanding_level BETWEEN 1 AND 5),
  focus_level integer NOT NULL CHECK (focus_level BETWEEN 1 AND 5),
  reason_codes jsonb NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX lesson_feedback_events_student_id_idx ON lesson_feedback_events(student_id);

CREATE TABLE session_adjustment_proposals (
  id varchar(200) PRIMARY KEY,
  student_id varchar(100) NOT NULL REFERENCES students(id),
  base_revision integer NOT NULL CHECK (base_revision >= 0),
  proposal_json jsonb NOT NULL,
  status varchar(20) NOT NULL CHECK (status IN ('pending', 'confirmed', 'expired', 'cancelled')),
  created_at timestamptz NOT NULL,
  confirmed_at timestamptz
);
CREATE INDEX session_adjustment_proposals_student_status_idx ON session_adjustment_proposals(student_id, status);
CREATE INDEX session_adjustment_proposals_created_at_idx ON session_adjustment_proposals(created_at);
