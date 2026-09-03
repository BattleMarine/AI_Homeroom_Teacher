import { randomUUID } from "node:crypto";
import type { CourseCatalog, CourseCatalogRepository } from "../course-catalog/course-catalog.types.js";
import type {
  CurriculumPresentation,
  StudentCurriculumRepository,
  SubjectEnrollmentInput,
} from "../student-curriculum/student-curriculum.types.js";
import type {
  SubjectEnrollmentConfirmationInput,
  SubjectEnrollmentConfirmationResult,
  SubjectEnrollmentProposal,
  SubjectEnrollmentProposalInput,
  SubjectEnrollmentProposalResult,
  SubjectEnrollmentProposalRepository,
} from "./subject-enrollment.types.js";

const supportedSubjectPrimarySubjects: Record<string, string> = {
  "korean-language-media": "국어",
  "english-reading": "영어",
};
const proposalLifetimeMs = 30 * 60 * 1000;

type PendingProposal = {
  input: SubjectEnrollmentProposalInput;
  proposal: SubjectEnrollmentProposal;
  confirmation?: SubjectEnrollmentConfirmationResult & { kind: "confirmed" };
};

export function createSubjectEnrollmentService(
  courseCatalogRepository: CourseCatalogRepository,
  studentCurriculumRepository?: StudentCurriculumRepository,
  proposalRepository?: SubjectEnrollmentProposalRepository,
) {
  const pendingProposals = new Map<string, PendingProposal>();

  return {
    async propose(input: SubjectEnrollmentProposalInput): Promise<SubjectEnrollmentProposalResult> {
      const courseCatalog = await courseCatalogRepository.getCourseCatalog(input.courseId);
      if (!courseCatalog) return { kind: "course-not-found" };

      const expectedPrimarySubject = supportedSubjectPrimarySubjects[input.subjectCode];
      if (!expectedPrimarySubject || courseCatalog.course.primarySubject !== expectedPrimarySubject) {
        return { kind: "course-subject-mismatch", course: courseCatalog.course };
      }

      const existingCurriculums = studentCurriculumRepository
        ? await studentCurriculumRepository.listForStudent(input.studentId)
        : [];
      if (existingCurriculums.some((curriculum) => curriculum.subjectCode === input.subjectCode && curriculum.status !== "archived")) {
        return { kind: "subject-already-enrolled" };
      }

      const contentLessons = courseCatalog.lessons.filter((lesson) => lesson.lessonType !== "orientation");
      const firstLesson = contentLessons[0];
      const estimatedTotalMinutes = Math.ceil(contentLessons.reduce((total, lesson) => total + lesson.duration.seconds, 0) / 60);
      const proposal: SubjectEnrollmentProposal = {
        proposalId: `enrollment-proposal:${randomUUID()}`,
        studentId: input.studentId,
        subjectCode: input.subjectCode,
        baseRevision: 0,
        interpretedRequest: { courseId: input.courseId, weeklyMinutes: input.weeklyMinutes ?? null },
        before: { enrolled: false },
        after: {
          course: courseCatalog.course,
          contentLessonCount: contentLessons.length,
          estimatedTotalMinutes,
          firstLesson: firstLesson
            ? { lessonId: firstLesson.id, title: firstLesson.title, estimatedMinutes: Math.ceil(firstLesson.duration.seconds / 60), unitNames: firstLesson.unitNames }
            : null,
        },
        scheduleImpact: { kind: "not-assessed", message: "전체 과목 일정 영향은 아직 계산하지 않았습니다." },
        reasonCodes: ["catalog_course_verified", "subject_code_verified", "orientation_excluded"],
        warnings: [proposalRepository
          ? "학생의 명시적 확인 뒤에만 등록할 수 있습니다."
          : "이 제안은 아직 저장되지 않았습니다. 학생의 명시적 확인 뒤에만 등록할 수 있습니다."],
        requiresConfirmation: true,
        expiresAt: new Date(Date.now() + proposalLifetimeMs).toISOString(),
      };
      if (proposalRepository) await proposalRepository.create(proposal, input);
      else pendingProposals.set(proposal.proposalId, { input: { ...input }, proposal });
      return { kind: "success", proposal };
    },

    async confirm(input: SubjectEnrollmentConfirmationInput): Promise<SubjectEnrollmentConfirmationResult> {
      if (proposalRepository) {
        return confirmPersistedProposal(input, proposalRepository, courseCatalogRepository, studentCurriculumRepository);
      }
      const pending = pendingProposals.get(input.proposalId);
      if (!pending || pending.proposal.studentId !== input.studentId) return { kind: "proposal-not-found" };
      if (pending.confirmation) return pending.confirmation;
      if (input.expectedRevision !== undefined && input.expectedRevision !== pending.proposal.baseRevision) {
        return { kind: "revision-conflict", currentRevision: pending.proposal.baseRevision };
      }
      if (Date.parse(pending.proposal.expiresAt) <= Date.now()) {
        pendingProposals.delete(input.proposalId);
        return { kind: "proposal-expired" };
      }
      if (!studentCurriculumRepository?.enrollSubject) return { kind: "persistence-unavailable" };

      const courseCatalog = await courseCatalogRepository.getCourseCatalog(pending.input.courseId);
      if (!courseCatalog) return { kind: "proposal-not-found" };
      const enrolled = await studentCurriculumRepository.enrollSubject(
        createInitialSubjectEnrollment(pending.proposal, courseCatalog),
      );
      if (enrolled.kind === "already-enrolled") return { kind: "subject-already-enrolled" };

      const confirmation = { kind: "confirmed", curriculum: enrolled.curriculum } as const;
      pending.confirmation = confirmation;
      return confirmation;
    },
  };
}

async function confirmPersistedProposal(
  input: SubjectEnrollmentConfirmationInput,
  proposalRepository: SubjectEnrollmentProposalRepository,
  courseCatalogRepository: CourseCatalogRepository,
  studentCurriculumRepository: StudentCurriculumRepository | undefined,
): Promise<SubjectEnrollmentConfirmationResult> {
  const persisted = await proposalRepository.get(input.studentId, input.proposalId);
  if (!persisted) return { kind: "proposal-not-found" };
  if (persisted.status === "confirmed") {
    if (!persisted.curriculumId || !studentCurriculumRepository) return { kind: "proposal-not-found" };
    const curriculum = await studentCurriculumRepository.getById(input.studentId, persisted.curriculumId);
    return curriculum ? { kind: "confirmed", curriculum } : { kind: "proposal-not-found" };
  }
  if (persisted.status === "expired") return { kind: "proposal-expired" };
  if (persisted.status === "cancelled") return { kind: "subject-already-enrolled" };
  if (!studentCurriculumRepository) return { kind: "persistence-unavailable" };

  const courseCatalog = await courseCatalogRepository.getCourseCatalog(persisted.input.courseId);
  if (!courseCatalog) return { kind: "proposal-not-found" };
  const result = await proposalRepository.confirm({
    ...input,
    enrollment: createInitialSubjectEnrollment(persisted.proposal, courseCatalog),
  });
  if (result.kind === "proposal-not-found") return result;
  if (result.kind === "proposal-expired") return result;
  if (result.kind === "revision-conflict") return result;
  if (result.kind === "subject-already-enrolled") return result;

  const curriculum = await studentCurriculumRepository.getById(input.studentId, result.curriculumId);
  return curriculum ? { kind: "confirmed", curriculum } : { kind: "proposal-not-found" };
}
function createInitialSubjectEnrollment(proposal: SubjectEnrollmentProposal, catalog: CourseCatalog): SubjectEnrollmentInput {
  const lessons = catalog.lessons.filter((lesson) => lesson.lessonType !== "orientation");
  if (!lessons.length) throw new Error("등록할 수업 강의가 없습니다.");

  const presentation: CurriculumPresentation = {
    paceLabel: "기본 등록안",
    description: `${catalog.course.title}의 원본 강의 순서를 기준으로 시작합니다.`,
    recommendedFor: ["선택한 강좌를 수강하려는 학생"],
    teacherComment: "첫 학습 결과를 받은 뒤 수업량과 보강을 조율하겠습니다.",
  };
  const steps = lessons.map((lesson, index) => {
    const sequence = String(index + 1).padStart(3, "0");
    const conceptTags = [...new Set([catalog.course.primarySubject, ...lesson.subjectAreas, ...lesson.unitNames])];
    const estimatedMinutes = Math.max(1, Math.ceil(lesson.duration.seconds / 60));
    return {
      sourceId: `step-${sequence}`,
      title: lesson.title,
      goal: lesson.unitNames.length ? lesson.unitNames.join(" · ") : null,
      conceptTags,
      estimatedMinutes,
      items: [{
        sourceId: `item-${sequence}`,
        kind: "lecture" as const,
        lessonId: lesson.id,
        title: lesson.title,
        description: null,
        conceptTags,
        estimatedMinutes,
        required: true,
        reason: "선택한 강좌의 원본 순서",
      }],
    };
  });
  const firstStep = steps[0];
  return {
    id: `enrollment:${randomUUID()}`,
    studentId: proposal.studentId,
    subjectCode: proposal.subjectCode,
    title: catalog.course.title,
    presentation,
    state: {
      currentStepId: firstStep.sourceId,
      currentItemId: firstStep.items[0].sourceId,
      completedItemIds: [],
      reinforcementConcepts: [],
      maxSessionMinutes: 45,
    },
    version: {
      changeReason: "initial",
      changeSummary: "과목 등록 확인 후 강좌 원본 순서로 초기 커리큘럼을 만들었습니다.",
      steps,
    },
  };
}