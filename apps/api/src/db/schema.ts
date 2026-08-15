import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
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
