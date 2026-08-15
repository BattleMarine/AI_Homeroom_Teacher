ALTER TABLE student_curricula
  ADD COLUMN presentation_json jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE curriculum_steps ADD COLUMN source_id varchar(200);
UPDATE curriculum_steps
  SET source_id = substr(id, char_length(curriculum_version_id) + 2)
  WHERE source_id IS NULL;
ALTER TABLE curriculum_steps ALTER COLUMN source_id SET NOT NULL;
ALTER TABLE curriculum_steps
  ADD CONSTRAINT curriculum_steps_version_source_id_key UNIQUE (curriculum_version_id, source_id);

ALTER TABLE curriculum_items ADD COLUMN source_id varchar(200);
UPDATE curriculum_items AS item
  SET source_id = substr(item.id, char_length(step.id) + 2)
  FROM curriculum_steps AS step
  WHERE item.curriculum_step_id = step.id AND item.source_id IS NULL;
ALTER TABLE curriculum_items ALTER COLUMN source_id SET NOT NULL;
ALTER TABLE curriculum_items
  ADD CONSTRAINT curriculum_items_step_source_id_key UNIQUE (curriculum_step_id, source_id);

ALTER TABLE student_learning_states ADD COLUMN subject_code varchar(100) NOT NULL DEFAULT 'math-logarithm';
ALTER TABLE student_learning_states DROP CONSTRAINT student_learning_states_pkey;
ALTER TABLE student_learning_states ADD PRIMARY KEY (student_id, subject_code);

ALTER TABLE lesson_feedback_events ADD COLUMN subject_code varchar(100) NOT NULL DEFAULT 'math-logarithm';
CREATE INDEX lesson_feedback_events_student_subject_idx ON lesson_feedback_events(student_id, subject_code);

ALTER TABLE session_adjustment_proposals ADD COLUMN subject_code varchar(100) NOT NULL DEFAULT 'math-logarithm';
CREATE INDEX session_adjustment_proposals_student_subject_status_idx
  ON session_adjustment_proposals(student_id, subject_code, status);
