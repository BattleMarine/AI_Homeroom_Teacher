import { boolean, check, date, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid, varchar, type PgTableExtraConfigValue } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const students = pgTable("students", {
  id: varchar("id", { length: 100 }).primaryKey(),
  displayName: varchar("display_name", { length: 100 }),
  status: varchar("status", { length: 20 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const courses = pgTable("courses", {
  id: varchar("id", { length: 200 }).primaryKey(),
  providerId: varchar("provider_id", { length: 100 }).notNull(),
  providerName: varchar("provider_name", { length: 200 }).notNull(),
  instructorId: varchar("instructor_id", { length: 100 }).notNull(),
  instructorName: varchar("instructor_name", { length: 200 }).notNull(),
  title: varchar("title", { length: 500 }).notNull(),
  primarySubject: varchar("primary_subject", { length: 100 }).notNull(),
  includedSubjects: jsonb("included_subjects").notNull(),
  curriculumYear: integer("curriculum_year"),
  lessonCount: integer("lesson_count").notNull(),
  orientationCount: integer("orientation_count").notNull(),
  contentLessonCount: integer("content_lesson_count").notNull(),
  totalDurationSeconds: integer("total_duration_seconds").notNull(),
  sourceUrl: text("source_url"),
  status: varchar("status", { length: 30 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const lessons = pgTable("lessons", {
  id: varchar("id", { length: 200 }).primaryKey(),
  courseId: varchar("course_id", { length: 200 }).notNull().references(() => courses.id),
  sequence: integer("sequence").notNull(),
  lectureNumber: integer("lecture_number"),
  title: varchar("title", { length: 500 }).notNull(),
  lessonType: varchar("lesson_type", { length: 30 }).notNull(),
  subjectAreas: jsonb("subject_areas").notNull(),
  unitNames: jsonb("unit_names").notNull(),
  durationDisplay: varchar("duration_display", { length: 50 }),
  durationSeconds: integer("duration_seconds").notNull(),
  sourceUrl: text("source_url"),
  playbackTargetId: varchar("playback_target_id", { length: 200 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => [
  uniqueIndex("lessons_course_sequence_key").on(table.courseId, table.sequence),
  index("lessons_course_id_idx").on(table.courseId),
  index("lessons_course_lesson_type_idx").on(table.courseId, table.lessonType),
]);

export const studentLearningStates = pgTable("student_learning_states", {
  studentId: varchar("student_id", { length: 100 }).notNull().references(() => students.id),
  subjectCode: varchar("subject_code", { length: 100 }).notNull(),
  revision: integer("revision").notNull(),
  stateJson: jsonb("state_json").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => [uniqueIndex("student_learning_states_student_subject_key").on(table.studentId, table.subjectCode)]);

export const studentCurricula = pgTable("student_curricula", {
  id: varchar("id", { length: 200 }).primaryKey(),
  studentId: varchar("student_id", { length: 100 }).notNull().references(() => students.id),
  subjectCode: varchar("subject_code", { length: 100 }).notNull(),
  title: varchar("title", { length: 500 }).notNull(),
  status: varchar("status", { length: 20 }).notNull(),
  presentationJson: jsonb("presentation_json").notNull(),
  currentVersionId: varchar("current_version_id", { length: 200 }),
  revision: integer("revision").notNull(),
  stateJson: jsonb("state_json").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => [
  uniqueIndex("student_curricula_active_subject_key").on(table.studentId, table.subjectCode).where(sql`${table.status} = 'active'`),
  index("student_curricula_student_id_idx").on(table.studentId),
]);

export const curriculumVersions = pgTable("curriculum_versions", {
  id: varchar("id", { length: 200 }).primaryKey(),
  studentCurriculumId: varchar("student_curriculum_id", { length: 200 }).notNull().references(() => studentCurricula.id),
  versionNumber: integer("version_number").notNull(),
  changeReason: varchar("change_reason", { length: 50 }).notNull(),
  changeSummary: text("change_summary"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => [uniqueIndex("curriculum_versions_curriculum_version_key").on(table.studentCurriculumId, table.versionNumber)]);

export const curriculumSteps = pgTable("curriculum_steps", {
  id: varchar("id", { length: 200 }).primaryKey(),
  curriculumVersionId: varchar("curriculum_version_id", { length: 200 }).notNull().references(() => curriculumVersions.id),
  sequence: integer("sequence").notNull(),
  sourceId: varchar("source_id", { length: 200 }).notNull(),
  title: varchar("title", { length: 500 }).notNull(),
  goal: text("goal"),
  conceptTags: jsonb("concept_tags").notNull(),
  estimatedMinutes: integer("estimated_minutes").notNull(),
}, (table) => [
  uniqueIndex("curriculum_steps_version_sequence_key").on(table.curriculumVersionId, table.sequence),
  uniqueIndex("curriculum_steps_version_source_id_key").on(table.curriculumVersionId, table.sourceId),
]);

export const curriculumItems = pgTable("curriculum_items", {
  id: varchar("id", { length: 200 }).primaryKey(),
  curriculumStepId: varchar("curriculum_step_id", { length: 200 }).notNull().references(() => curriculumSteps.id),
  sequence: integer("sequence").notNull(),
  sourceId: varchar("source_id", { length: 200 }).notNull(),
  kind: varchar("kind", { length: 20 }).notNull(),
  lessonId: varchar("lesson_id", { length: 200 }).references(() => lessons.id),
  title: varchar("title", { length: 500 }).notNull(),
  description: text("description"),
  conceptTags: jsonb("concept_tags").notNull(),
  estimatedMinutes: integer("estimated_minutes").notNull(),
  required: boolean("required").notNull(),
  reason: text("reason"),
}, (table) => [
  uniqueIndex("curriculum_items_step_sequence_key").on(table.curriculumStepId, table.sequence),
  uniqueIndex("curriculum_items_step_source_id_key").on(table.curriculumStepId, table.sourceId),
  check("curriculum_items_lecture_requires_lesson_check", sql`${table.kind} <> 'lecture' OR ${table.lessonId} IS NOT NULL`),
]);

export const lessonFeedbackEvents = pgTable("lesson_feedback_events", {
  id: uuid("id").primaryKey(),
  studentId: varchar("student_id", { length: 100 }).notNull().references(() => students.id),
  subjectCode: varchar("subject_code", { length: 100 }).notNull(),
  lessonItemId: varchar("lesson_item_id", { length: 200 }).notNull(),
  understandingLevel: integer("understanding_level").notNull(),
  focusLevel: integer("focus_level").notNull(),
  reasonCodes: jsonb("reason_codes").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => [index("lesson_feedback_events_student_subject_idx").on(table.studentId, table.subjectCode)]);

export const subjectEnrollmentProposals = pgTable("subject_enrollment_proposals", {
  id: varchar("id", { length: 200 }).primaryKey(),
  studentId: varchar("student_id", { length: 100 }).notNull().references(() => students.id),
  subjectCode: varchar("subject_code", { length: 100 }).notNull(),
  courseId: varchar("course_id", { length: 200 }).notNull().references(() => courses.id),
  baseRevision: integer("base_revision").notNull(),
  requestJson: jsonb("request_json").notNull(),
  proposalJson: jsonb("proposal_json").notNull(),
  status: varchar("status", { length: 20 }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  curriculumId: varchar("curriculum_id", { length: 200 }).references(() => studentCurricula.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => [
  index("subject_enrollment_proposals_student_subject_status_idx").on(table.studentId, table.subjectCode, table.status),
  index("subject_enrollment_proposals_expires_at_idx").on(table.expiresAt),
]);
export const sessionAdjustmentProposals = pgTable("session_adjustment_proposals", {
  id: varchar("id", { length: 200 }).primaryKey(),
  studentId: varchar("student_id", { length: 100 }).notNull().references(() => students.id),
  subjectCode: varchar("subject_code", { length: 100 }).notNull(),
  baseRevision: integer("base_revision").notNull(),
  proposalJson: jsonb("proposal_json").notNull(),
  status: varchar("status", { length: 20 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
}, (table) => [
  index("session_adjustment_proposals_student_subject_status_idx").on(table.studentId, table.subjectCode, table.status),
  index("session_adjustment_proposals_created_at_idx").on(table.createdAt),
]);

// 학생 전체 계획은 기존 과목별 커리큘럼/피드백과 독립적으로 보존한다.
export const learningPlans = pgTable("learning_plans", {
  id: varchar("id", { length: 200 }).primaryKey(),
  studentId: varchar("student_id", { length: 100 }).notNull().references(() => students.id),
  currentVersionId: varchar("current_version_id", { length: 200 }),
  planRevision: integer("plan_revision").notNull().default(0),
  completionRevision: integer("completion_revision").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table): PgTableExtraConfigValue[] => [
  uniqueIndex("learning_plans_student_key").on(table.studentId),
  uniqueIndex("learning_plans_student_id_key").on(table.studentId, table.id),
  check("learning_plans_plan_revision_check", sql`${table.planRevision} >= 0`),
  check("learning_plans_completion_revision_check", sql`${table.completionRevision} >= 0`),
  foreignKey({ name: "learning_plans_current_version_fk", columns: [table.id, table.currentVersionId],
    foreignColumns: [learningPlanVersions.planId, learningPlanVersions.id] }),
]);

export const learningPlanVersions = pgTable("learning_plan_versions", {
  id: varchar("id", { length: 200 }).primaryKey(),
  planId: varchar("plan_id", { length: 200 }).notNull().references(() => learningPlans.id),
  versionNumber: integer("version_number").notNull(),
  kind: varchar("kind", { length: 20 }).notNull(),
  scopeJson: jsonb("scope_json").notNull(), reason: text("reason").notNull(), diffJson: jsonb("diff_json").notNull(),
  candidateJson: jsonb("candidate_json").notNull(), catalogHash: varchar("catalog_hash", { length: 64 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table): PgTableExtraConfigValue[] => [
  uniqueIndex("learning_plan_versions_number_key").on(table.planId, table.versionNumber),
  uniqueIndex("learning_plan_versions_plan_id_key").on(table.planId, table.id),
  check("learning_plan_versions_number_check", sql`${table.versionNumber} > 0`),
  check("learning_plan_versions_kind_check", sql`${table.kind} IN ('create','adjust','rebalance')`),
]);

export const learningPlanItems = pgTable("learning_plan_items", {
  planId: varchar("plan_id", { length: 200 }).notNull().references(() => learningPlans.id),
  itemKey: varchar("item_key", { length: 200 }).notNull(),
  lessonId: varchar("lesson_id", { length: 200 }).notNull().references(() => lessons.id),
  subjectCode: varchar("subject_code", { length: 100 }).notNull(),
  itemSnapshotJson: jsonb("item_snapshot_json").notNull(),
  positionSeconds: integer("position_seconds").notNull().default(0),
  carryoverSinceDate: date("carryover_since_date", { mode: "string" }),
}, (table) => [primaryKey({ columns: [table.planId, table.itemKey] }),
  check("learning_plan_items_position_check", sql`${table.positionSeconds} >= 0 AND ${table.positionSeconds} <= (${table.itemSnapshotJson}->>'durationSeconds')::integer`),
]);

export const learningPlanAssignments = pgTable("learning_plan_assignments", {
  planId: varchar("plan_id", { length: 200 }).notNull(), versionId: varchar("version_id", { length: 200 }).notNull(),
  itemKey: varchar("item_key", { length: 200 }).notNull(), scheduledDate: date("scheduled_date", { mode: "string" }).notNull(),
  itemOrder: integer("item_order").notNull(), durationSeconds: integer("duration_seconds").notNull(),
  segmentKey: varchar("segment_key", { length: 200 }).notNull(),
  startOffsetSeconds: integer("start_offset_seconds").notNull(), endOffsetSeconds: integer("end_offset_seconds").notNull(),
}, (table) => [
  primaryKey({ columns: [table.versionId, table.segmentKey] }),
  uniqueIndex("learning_plan_assignments_date_order_key").on(table.versionId, table.scheduledDate, table.itemOrder),
  foreignKey({ columns: [table.planId, table.versionId], foreignColumns: [learningPlanVersions.planId, learningPlanVersions.id] }),
  foreignKey({ columns: [table.planId, table.itemKey], foreignColumns: [learningPlanItems.planId, learningPlanItems.itemKey] }),
  check("learning_plan_assignments_order_check", sql`${table.itemOrder} >= 0`),
  check("learning_plan_assignments_duration_check", sql`${table.durationSeconds} > 0`),
  check("learning_plan_assignments_segment_check", sql`${table.startOffsetSeconds} >= 0 AND ${table.endOffsetSeconds} > ${table.startOffsetSeconds}
    AND ${table.durationSeconds} = ${table.endOffsetSeconds} - ${table.startOffsetSeconds}`),
]);

export const learningPlanCompletions = pgTable("learning_plan_completions", {
  planId: varchar("plan_id", { length: 200 }).notNull(), itemKey: varchar("item_key", { length: 200 }).notNull(),
  payloadJson: jsonb("payload_json"), completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
  completionRevision: integer("completion_revision").notNull(),
}, (table) => [
  primaryKey({ columns: [table.planId, table.itemKey] }),
  uniqueIndex("learning_plan_completions_revision_key").on(table.planId, table.completionRevision),
  foreignKey({ columns: [table.planId, table.itemKey], foreignColumns: [learningPlanItems.planId, learningPlanItems.itemKey] }),
  check("learning_plan_completions_revision_check", sql`${table.completionRevision} > 0`),
]);

export const learningPlanCompletionKeys = pgTable("learning_plan_completion_keys", {
  planId: varchar("plan_id", { length: 200 }).notNull(), idempotencyKey: varchar("idempotency_key", { length: 200 }).notNull(),
  itemKey: varchar("item_key", { length: 200 }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.planId, table.idempotencyKey] }),
  foreignKey({ columns: [table.planId, table.itemKey], foreignColumns: [learningPlanCompletions.planId, learningPlanCompletions.itemKey] }),
]);

export const learningPlanFeedbacks = pgTable("learning_plan_feedbacks", {
  planId: varchar("plan_id", { length: 200 }).notNull(), itemKey: varchar("item_key", { length: 200 }).notNull(),
  payloadJson: jsonb("payload_json").notNull(), submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull(),
  feedbackRevision: integer("feedback_revision").notNull(),
}, (table) => [
  primaryKey({ columns: [table.planId, table.itemKey] }),
  uniqueIndex("learning_plan_feedbacks_revision_key").on(table.planId, table.feedbackRevision),
  foreignKey({ columns: [table.planId, table.itemKey], foreignColumns: [learningPlanCompletions.planId, learningPlanCompletions.itemKey] }),
  check("learning_plan_feedbacks_revision_check", sql`${table.feedbackRevision} > 0`),
]);

export const learningPlanProgressEvents = pgTable("learning_plan_progress_events", {
  id: uuid("id").primaryKey(), planId: varchar("plan_id", { length: 200 }).notNull(), itemKey: varchar("item_key", { length: 200 }).notNull(),
  idempotencyKey: varchar("idempotency_key", { length: 200 }).notNull(),
  positionSeconds: integer("position_seconds").notNull(), spentSeconds: integer("spent_seconds").notNull(),
  studyDate: date("study_date", { mode: "string" }).notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  executionRevision: integer("execution_revision").notNull(), requestJson: jsonb("request_json").notNull(), resultJson: jsonb("result_json").notNull(),
}, (table) => [
  foreignKey({ columns: [table.planId, table.itemKey], foreignColumns: [learningPlanItems.planId, learningPlanItems.itemKey] }),
  uniqueIndex("learning_plan_progress_events_key").on(table.planId, table.idempotencyKey),
  uniqueIndex("learning_plan_progress_events_revision_key").on(table.planId, table.executionRevision),
  index("learning_plan_progress_events_daily_idx").on(table.planId, table.studyDate),
  check("learning_plan_progress_events_position_check", sql`${table.positionSeconds} >= 0`),
  check("learning_plan_progress_events_spent_check", sql`${table.spentSeconds} >= 0 AND ${table.spentSeconds} <= 86400`),
  check("learning_plan_progress_events_revision_check", sql`${table.executionRevision} > 0`),
]);

export const learningPlanProposals = pgTable("learning_plan_proposals", {
  id: varchar("id", { length: 200 }).primaryKey(),
  studentId: varchar("student_id", { length: 100 }).notNull().references(() => students.id),
  targetPlanId: varchar("target_plan_id", { length: 200 }).notNull(), expectedPlanId: varchar("expected_plan_id", { length: 200 }),
  expectedBasisJson: jsonb("expected_basis_json").notNull(), inputJson: jsonb("input_json").notNull(),
  status: varchar("status", { length: 20 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }), confirmedVersionId: varchar("confirmed_version_id", { length: 200 }),
  resultJson: jsonb("result_json"),
}, (table) => [
  foreignKey({ columns: [table.studentId, table.expectedPlanId], foreignColumns: [learningPlans.studentId, learningPlans.id] }),
  foreignKey({ columns: [table.targetPlanId, table.confirmedVersionId], foreignColumns: [learningPlanVersions.planId, learningPlanVersions.id] }),
  index("learning_plan_proposals_student_status_idx").on(table.studentId, table.status),
  index("learning_plan_proposals_expires_at_idx").on(table.expiresAt),
  check("learning_plan_proposals_status_check", sql`${table.status} IN ('pending','confirmed','expired')`),
  check("learning_plan_proposals_expiry_check", sql`${table.expiresAt} > ${table.createdAt}`),
  check("learning_plan_proposals_result_check", sql`(${table.status} = 'confirmed' AND ${table.confirmedAt} IS NOT NULL
    AND ${table.confirmedVersionId} IS NOT NULL AND ${table.resultJson} IS NOT NULL) OR (${table.status} <> 'confirmed'
    AND ${table.confirmedAt} IS NULL AND ${table.confirmedVersionId} IS NULL AND ${table.resultJson} IS NULL)`),
]);
