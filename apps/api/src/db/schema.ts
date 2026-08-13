import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

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
  curriculumYear: integer("curriculum_year").notNull(),
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
  durationDisplay: varchar("duration_display", { length: 50 }).notNull(),
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
  studentId: varchar("student_id", { length: 100 }).primaryKey().references(() => students.id),
  revision: integer("revision").notNull(),
  stateJson: jsonb("state_json").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const lessonFeedbackEvents = pgTable("lesson_feedback_events", {
  id: uuid("id").primaryKey(),
  studentId: varchar("student_id", { length: 100 }).notNull().references(() => students.id),
  lessonItemId: varchar("lesson_item_id", { length: 200 }).notNull(),
  understandingLevel: integer("understanding_level").notNull(),
  focusLevel: integer("focus_level").notNull(),
  reasonCodes: jsonb("reason_codes").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => [index("lesson_feedback_events_student_id_idx").on(table.studentId)]);

export const sessionAdjustmentProposals = pgTable("session_adjustment_proposals", {
  id: varchar("id", { length: 200 }).primaryKey(),
  studentId: varchar("student_id", { length: 100 }).notNull().references(() => students.id),
  baseRevision: integer("base_revision").notNull(),
  proposalJson: jsonb("proposal_json").notNull(),
  status: varchar("status", { length: 20 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
}, (table) => [
  index("session_adjustment_proposals_student_status_idx").on(table.studentId, table.status),
  index("session_adjustment_proposals_created_at_idx").on(table.createdAt),
]);
