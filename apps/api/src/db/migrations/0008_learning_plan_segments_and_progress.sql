-- 0007과 과거 snapshot JSON을 보존하며 예정 구간/실제 진도를 추가한다.
ALTER TABLE learning_plan_assignments ADD COLUMN segment_key varchar(200);
ALTER TABLE learning_plan_assignments ADD COLUMN start_offset_seconds integer;
ALTER TABLE learning_plan_assignments ADD COLUMN end_offset_seconds integer;
UPDATE learning_plan_assignments SET segment_key=item_key,start_offset_seconds=0,end_offset_seconds=duration_seconds;
ALTER TABLE learning_plan_assignments ALTER COLUMN segment_key SET NOT NULL;
ALTER TABLE learning_plan_assignments ALTER COLUMN start_offset_seconds SET NOT NULL;
ALTER TABLE learning_plan_assignments ALTER COLUMN end_offset_seconds SET NOT NULL;
ALTER TABLE learning_plan_assignments DROP CONSTRAINT learning_plan_assignments_pkey;
ALTER TABLE learning_plan_assignments ADD PRIMARY KEY (version_id,segment_key);
ALTER TABLE learning_plan_assignments ADD CONSTRAINT learning_plan_assignments_segment_check
  CHECK (start_offset_seconds >= 0 AND end_offset_seconds > start_offset_seconds
    AND duration_seconds = end_offset_seconds-start_offset_seconds);

ALTER TABLE learning_plan_items ADD COLUMN item_snapshot_json jsonb;
UPDATE learning_plan_items i SET item_snapshot_json=(
  SELECT item.value FROM learning_plan_versions v,
    LATERAL jsonb_array_elements(v.candidate_json->'items') item(value)
  WHERE v.plan_id=i.plan_id AND item.value->>'itemKey'=i.item_key ORDER BY v.version_number LIMIT 1
);
-- 출처 snapshot을 복구할 수 없다면 migration을 실패시킨다. 현재 카탈로그로 과거를 꾸미지 않는다.
ALTER TABLE learning_plan_items ALTER COLUMN item_snapshot_json SET NOT NULL;
ALTER TABLE learning_plan_items ADD COLUMN position_seconds integer NOT NULL DEFAULT 0;
ALTER TABLE learning_plan_items ADD COLUMN carryover_since_date date;
UPDATE learning_plan_items i SET position_seconds=(i.item_snapshot_json->>'durationSeconds')::integer
  WHERE EXISTS (SELECT 1 FROM learning_plan_completions c WHERE c.plan_id=i.plan_id AND c.item_key=i.item_key);
ALTER TABLE learning_plan_items ADD CONSTRAINT learning_plan_items_position_check
  CHECK (position_seconds >= 0 AND position_seconds <= (item_snapshot_json->>'durationSeconds')::integer);

-- null은 실제 완료했지만 feedback을 제출하지 않은 상태다. {}와 구분한다.
ALTER TABLE learning_plan_completions ALTER COLUMN payload_json DROP NOT NULL;

CREATE TABLE learning_plan_feedbacks (
  plan_id varchar(200) NOT NULL,
  item_key varchar(200) NOT NULL,
  payload_json jsonb NOT NULL,
  submitted_at timestamptz NOT NULL,
  feedback_revision integer NOT NULL CHECK (feedback_revision > 0),
  PRIMARY KEY (plan_id,item_key),
  UNIQUE (plan_id,feedback_revision),
  FOREIGN KEY (plan_id,item_key) REFERENCES learning_plan_completions(plan_id,item_key)
);
-- 기존 완료 본문은 제출된 feedback으로 복사하며 완료 행/시각/원본 JSON은 그대로 둔다.
INSERT INTO learning_plan_feedbacks(plan_id,item_key,payload_json,submitted_at,feedback_revision)
  SELECT plan_id,item_key,payload_json,completed_at,completion_revision
  FROM learning_plan_completions WHERE payload_json IS NOT NULL;

CREATE TABLE learning_plan_progress_events (
  id uuid PRIMARY KEY,
  plan_id varchar(200) NOT NULL,
  item_key varchar(200) NOT NULL,
  idempotency_key varchar(200) NOT NULL,
  position_seconds integer NOT NULL CHECK (position_seconds >= 0),
  spent_seconds integer NOT NULL CHECK (spent_seconds >= 0 AND spent_seconds <= 86400),
  study_date date NOT NULL,
  created_at timestamptz NOT NULL,
  execution_revision integer NOT NULL CHECK (execution_revision > 0),
  request_json jsonb NOT NULL,
  result_json jsonb NOT NULL,
  FOREIGN KEY (plan_id,item_key) REFERENCES learning_plan_items(plan_id,item_key),
  UNIQUE (plan_id,idempotency_key),
  UNIQUE (plan_id,execution_revision)
);
CREATE INDEX learning_plan_progress_events_daily_idx ON learning_plan_progress_events(plan_id,study_date);
