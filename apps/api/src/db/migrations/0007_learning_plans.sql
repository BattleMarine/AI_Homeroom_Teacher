-- 기존 과목별 학습 이력과 분리된 학생 단위 전체 일정 저장. 기존 테이블/데이터를 변경하지 않는다.
CREATE TABLE learning_plans (
  id varchar(200) PRIMARY KEY,
  student_id varchar(100) NOT NULL REFERENCES students(id),
  current_version_id varchar(200),
  plan_revision integer NOT NULL DEFAULT 0 CHECK (plan_revision >= 0),
  completion_revision integer NOT NULL DEFAULT 0 CHECK (completion_revision >= 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (student_id),
  UNIQUE (student_id, id)
);

CREATE TABLE learning_plan_versions (
  id varchar(200) PRIMARY KEY,
  plan_id varchar(200) NOT NULL REFERENCES learning_plans(id),
  version_number integer NOT NULL CHECK (version_number > 0),
  kind varchar(20) NOT NULL CHECK (kind IN ('create', 'adjust', 'rebalance')),
  scope_json jsonb NOT NULL,
  reason text NOT NULL,
  diff_json jsonb NOT NULL,
  candidate_json jsonb NOT NULL,
  catalog_hash varchar(64) NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (plan_id, version_number),
  UNIQUE (plan_id, id)
);
ALTER TABLE learning_plans ADD CONSTRAINT learning_plans_current_version_fk
  FOREIGN KEY (id, current_version_id) REFERENCES learning_plan_versions(plan_id, id);

CREATE TABLE learning_plan_items (
  plan_id varchar(200) NOT NULL REFERENCES learning_plans(id),
  item_key varchar(200) NOT NULL,
  lesson_id varchar(200) NOT NULL REFERENCES lessons(id),
  subject_code varchar(100) NOT NULL,
  PRIMARY KEY (plan_id, item_key)
);

CREATE TABLE learning_plan_assignments (
  plan_id varchar(200) NOT NULL,
  version_id varchar(200) NOT NULL,
  item_key varchar(200) NOT NULL,
  scheduled_date date NOT NULL,
  item_order integer NOT NULL CHECK (item_order >= 0),
  duration_seconds integer NOT NULL CHECK (duration_seconds > 0),
  PRIMARY KEY (version_id, item_key),
  UNIQUE (version_id, scheduled_date, item_order),
  FOREIGN KEY (plan_id, version_id) REFERENCES learning_plan_versions(plan_id, id),
  FOREIGN KEY (plan_id, item_key) REFERENCES learning_plan_items(plan_id, item_key)
);

CREATE TABLE learning_plan_completions (
  plan_id varchar(200) NOT NULL,
  item_key varchar(200) NOT NULL,
  payload_json jsonb NOT NULL,
  completed_at timestamptz NOT NULL,
  completion_revision integer NOT NULL CHECK (completion_revision > 0),
  PRIMARY KEY (plan_id, item_key),
  UNIQUE (plan_id, completion_revision),
  FOREIGN KEY (plan_id, item_key) REFERENCES learning_plan_items(plan_id, item_key)
);

-- 같은 완료의 새 재시도 key도 보존하여 이후 다른 대상에 재사용되지 않게 한다.
CREATE TABLE learning_plan_completion_keys (
  plan_id varchar(200) NOT NULL,
  idempotency_key varchar(200) NOT NULL,
  item_key varchar(200) NOT NULL,
  PRIMARY KEY (plan_id, idempotency_key),
  FOREIGN KEY (plan_id, item_key) REFERENCES learning_plan_completions(plan_id, item_key)
);

CREATE TABLE learning_plan_proposals (
  id varchar(200) PRIMARY KEY,
  student_id varchar(100) NOT NULL REFERENCES students(id),
  target_plan_id varchar(200) NOT NULL,
  expected_plan_id varchar(200),
  expected_basis_json jsonb NOT NULL,
  input_json jsonb NOT NULL,
  status varchar(20) NOT NULL CHECK (status IN ('pending', 'confirmed', 'expired')),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at),
  confirmed_at timestamptz,
  confirmed_version_id varchar(200),
  result_json jsonb,
  FOREIGN KEY (student_id, expected_plan_id) REFERENCES learning_plans(student_id, id),
  FOREIGN KEY (target_plan_id, confirmed_version_id) REFERENCES learning_plan_versions(plan_id, id),
  CHECK ((status = 'confirmed' AND confirmed_at IS NOT NULL AND confirmed_version_id IS NOT NULL AND result_json IS NOT NULL)
    OR (status <> 'confirmed' AND confirmed_at IS NULL AND confirmed_version_id IS NULL AND result_json IS NULL))
);
CREATE INDEX learning_plan_proposals_student_status_idx ON learning_plan_proposals(student_id, status);
CREATE INDEX learning_plan_proposals_expires_at_idx ON learning_plan_proposals(expires_at);
