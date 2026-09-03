import type { CourseCatalogCourse } from "../course-catalog/course-catalog.types.js";
import type { StudentCurriculumDetail, SubjectEnrollmentInput } from "../student-curriculum/student-curriculum.types.js";

export type SubjectEnrollmentProposalInput = {
  studentId: string;
  subjectCode: string;
  courseId: string;
  weeklyMinutes?: number;
};

export type SubjectEnrollmentProposal = {
  proposalId: string;
  studentId: string;
  subjectCode: string;
  baseRevision: number;
  interpretedRequest: { courseId: string; weeklyMinutes: number | null };
  before: { enrolled: false };
  after: {
    course: CourseCatalogCourse;
    contentLessonCount: number;
    estimatedTotalMinutes: number;
    firstLesson: { lessonId: string; title: string; estimatedMinutes: number; unitNames: string[] } | null;
  };
  scheduleImpact: { kind: "not-assessed"; message: string };
  reasonCodes: string[];
  warnings: string[];
  requiresConfirmation: true;
  expiresAt: string;
};

export type SubjectEnrollmentProposalResult =
  | { kind: "success"; proposal: SubjectEnrollmentProposal }
  | { kind: "course-not-found" }
  | { kind: "course-subject-mismatch"; course: CourseCatalogCourse }
  | { kind: "subject-already-enrolled" };

export type SubjectEnrollmentConfirmationInput = {
  studentId: string;
  proposalId: string;
  expectedRevision?: number;
};

export type SubjectEnrollmentConfirmationResult =
  | { kind: "confirmed"; curriculum: StudentCurriculumDetail }
  | { kind: "proposal-not-found" }
  | { kind: "proposal-expired" }
  | { kind: "revision-conflict"; currentRevision: number }
  | { kind: "persistence-unavailable" }
  | { kind: "subject-already-enrolled" };

export type PersistedSubjectEnrollmentProposal = {
  proposal: SubjectEnrollmentProposal;
  input: SubjectEnrollmentProposalInput;
  status: "pending" | "confirmed" | "expired" | "cancelled";
  curriculumId: string | null;
};

export type SubjectEnrollmentProposalPersistenceResult =
  | { kind: "confirmed"; curriculumId: string }
  | { kind: "proposal-not-found" }
  | { kind: "proposal-expired" }
  | { kind: "revision-conflict"; currentRevision: number }
  | { kind: "subject-already-enrolled" };

export type SubjectEnrollmentProposalRepository = {
  create(proposal: SubjectEnrollmentProposal, input: SubjectEnrollmentProposalInput): Promise<void>;
  get(studentId: string, proposalId: string): Promise<PersistedSubjectEnrollmentProposal | undefined>;
  confirm(input: {
    studentId: string;
    proposalId: string;
    expectedRevision?: number;
    enrollment: SubjectEnrollmentInput;
  }): Promise<SubjectEnrollmentProposalPersistenceResult>;
};
