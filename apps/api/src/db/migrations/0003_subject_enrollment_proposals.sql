CREATE TABLE subject_enrollment_proposals (
  id varchar(200) PRIMARY KEY,
  student_id varchar(100) NOT NULL REFERENCES students(id),
  subject_code varchar(100) NOT NULL,
  course_id varchar(200) NOT NULL REFERENCES courses(id),
  base_revision integer NOT NULL CHECK (base_revision >= 0),
  request_json jsonb NOT NULL,
  proposal_json jsonb NOT NULL,
  status varchar(20) NOT NULL CHECK (status IN ('pending', 'confirmed', 'expired', 'cancelled')),
  expires_at timestamptz NOT NULL,
  confirmed_at timestamptz,
  curriculum_id varchar(200) REFERENCES student_curricula(id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX subject_enrollment_proposals_student_subject_status_idx
  ON subject_enrollment_proposals(student_id, subject_code, status);
CREATE INDEX subject_enrollment_proposals_expires_at_idx
  ON subject_enrollment_proposals(expires_at);
