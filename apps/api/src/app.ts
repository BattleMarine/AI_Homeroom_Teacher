import Fastify from "fastify";
import { registerChatRoutes } from "./llm-chat/llm-chat.js";
import type { ChatService } from "./llm-chat/llm-chat.js";
import type { LearningPlanStudentDirectory } from "./db/learning-plan-student-directory.js";
import { createLearningPlanService } from "./learning-plan/learning-plan.service.js";
import { registerLearningPlanRoutes } from "./learning-plan/learning-plan.routes.js";
import type { LearningPlanRepository } from "./learning-plan/learning-plan.repository.js";
import { createFileCourseCatalogRepository } from "./course-catalog/course-catalog.file-repository.js";
import type { CourseCatalogCourse, CourseCatalogRepository } from "./course-catalog/course-catalog.types.js";
import { createCurriculumRecommendationService } from "./curriculum-recommendation/curriculum-recommendation.service.js";
import type {
  CurriculumRecommendationInput,
  CurriculumRecommendationService,
} from "./curriculum-recommendation/curriculum-recommendation.types.js";
import { createCurriculumToolService } from "./curriculum-tools/curriculum-tool.service.js";
import {
  curriculumToolNames,
  type CurriculumToolInput,
  type CurriculumToolName,
  type CurriculumToolService,
} from "./curriculum-tools/curriculum-tool.types.js";
import { createProgressToolService } from "./progress-tools/progress-tool.service.js";
import { progressToolNames, type ProgressToolInput, type ProgressToolName, type ProgressToolService } from "./progress-tools/progress-tool.types.js";
import { readMockLessonPlaybackAsset } from "./lesson-playback/mock-lesson-playback.service.js";
import { createMemoryProgressService } from "./progress/progress.memory-service.js";
import { CurriculumSelectionRequiredError } from "./progress/progress.postgres-service.js";
import type { ProgressService } from "./progress/progress.types.js";
import type { StudentCurriculumRepository } from "./student-curriculum/student-curriculum.types.js";
import { createSubjectEnrollmentService } from "./subject-enrollment/subject-enrollment.service.js";
import type {
  SubjectEnrollmentConfirmationInput,
  SubjectEnrollmentProposalInput,
  SubjectEnrollmentProposalRepository,
} from "./subject-enrollment/subject-enrollment.types.js";
import { createTeacherLlmService } from "./teacher-llm/teacher-llm.service.js";
import type { TeacherLlmService } from "./teacher-llm/teacher-llm.types.js";

const messageRequestSchema = {
  type: "object",
  required: ["message"],
  properties: {
    studentId: { type: "string", minLength: 1, maxLength: 100 },
    subjectCode: { type: "string", minLength: 1, maxLength: 100, pattern: "^[a-z0-9][a-z0-9-]*$" },
    message: { type: "string", minLength: 1, maxLength: 2000 },
  },
  additionalProperties: false,
} as const;

const adjustmentConfirmationRequestSchema = {
  type: "object",
  properties: {
    studentId: { type: "string", minLength: 1, maxLength: 100 },
    subjectCode: { type: "string", minLength: 1, maxLength: 100, pattern: "^[a-z0-9][a-z0-9-]*$" },
    expectedRevision: { type: "integer", minimum: 0 },
  },
  additionalProperties: false,
} as const;

const lessonFeedbackRequestSchema = {
  type: "object",
  required: ["lessonId", "understandingLevel", "focusLevel"],
  properties: {
    studentId: { type: "string", minLength: 1, maxLength: 100 },
    subjectCode: { type: "string", minLength: 1, maxLength: 100, pattern: "^[a-z0-9][a-z0-9-]*$" },
    lessonId: { type: "string", minLength: 1 },
    understandingLevel: { type: "integer", minimum: 1, maximum: 5 },
    focusLevel: { type: "integer", minimum: 1, maximum: 5 },
  },
  additionalProperties: false,
} as const;

const curriculumSelectionRequestSchema = {
  type: "object",
  required: ["curriculumId"],
  properties: {
    studentId: { type: "string", minLength: 1, maxLength: 100 },
    subjectCode: { type: "string", minLength: 1, maxLength: 100, pattern: "^[a-z0-9][a-z0-9-]*$" },
    curriculumId: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
} as const;

const curriculumRecommendationRequestSchema = {
  type: "object",
  properties: {
    courseId: { type: "string", minLength: 1 },
    subjectArea: { type: "string", minLength: 1 },
    unitNames: {
      type: "array",
      items: { type: "string", minLength: 1 },
      maxItems: 50,
    },
    completedLessonIds: {
      type: "array",
      items: { type: "string", minLength: 1 },
      maxItems: 500,
    },
    weakUnitNames: {
      type: "array",
      items: { type: "string", minLength: 1 },
      maxItems: 50,
    },
    availableMinutesPerDay: { type: "integer", minimum: 1, maximum: 720 },
    targetDays: { type: "integer", minimum: 1, maximum: 3650 },
  },
  additionalProperties: false,
} as const;

const curriculumToolRequestSchema = {
  type: "object",
  required: ["tool"],
  properties: {
    tool: { type: "string", enum: curriculumToolNames },
    input: {
      type: "object",
      properties: {
        studentId: { type: "string", minLength: 1, maxLength: 100 },
        subjectCode: { type: "string", minLength: 1, maxLength: 100, pattern: "^[a-z0-9][a-z0-9-]*$" },
        courseId: { type: "string", minLength: 1 },
        subjectArea: { type: "string", minLength: 1 },
        unitNames: { type: "array", items: { type: "string", minLength: 1 }, maxItems: 50 },
        completedLessonIds: { type: "array", items: { type: "string", minLength: 1 }, maxItems: 500 },
        weakUnitNames: { type: "array", items: { type: "string", minLength: 1 }, maxItems: 50 },
        availableMinutesPerDay: { type: "integer", minimum: 1, maximum: 720 },
        targetDays: { type: "integer", minimum: 1, maximum: 3650 },
        planProfile: { type: "string", enum: ["stable", "compressed", "practice"] },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
} as const;

const progressToolRequestSchema = {
  type: "object",
  required: ["tool"],
  properties: {
    tool: { type: "string", enum: progressToolNames },
    input: {
      type: "object",
      properties: {
        studentId: { type: "string", minLength: 1, maxLength: 100 },
        subjectCode: { type: "string", minLength: 1, maxLength: 100, pattern: "^[a-z0-9][a-z0-9-]*$" },
        message: { type: "string", minLength: 1, maxLength: 2000 },
        concept: { type: "string", minLength: 1, maxLength: 200 },
        lessonItemId: { type: "string", minLength: 1, maxLength: 200 },
        estimatedMinutes: { type: "integer", minimum: 1, maximum: 180 },
        availableMinutesPerDay: { type: "integer", minimum: 1, maximum: 720 },
        targetDays: { type: "integer", minimum: 1, maximum: 3650 },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
} as const;
const studentQuerySchema = {
  type: "object",
  properties: {
    studentId: { type: "string", minLength: 1, maxLength: 100 },
    subjectCode: { type: "string", minLength: 1, maxLength: 100, pattern: "^[a-z0-9][a-z0-9-]*$" },
  },
  additionalProperties: false,
} as const;

const catalogSearchQuerySchema = {
  type: "object",
  required: ["query"],
  properties: {
    query: { type: "string", minLength: 1, maxLength: 100 },
    limit: { type: "integer", minimum: 1, maximum: 20 },
  },
  additionalProperties: false,
} as const;
const subjectEnrollmentProposalRequestSchema = {
  type: "object",
  required: ["studentId", "subjectCode", "courseId"],
  properties: {
    studentId: { type: "string", minLength: 1, maxLength: 100 },
    subjectCode: { type: "string", minLength: 1, maxLength: 100, pattern: "^[a-z0-9][a-z0-9-]*$" },
    courseId: { type: "string", minLength: 1, maxLength: 200 },
    weeklyMinutes: { type: "integer", minimum: 1, maximum: 10080 },
  },
  additionalProperties: false,
} as const;

const subjectEnrollmentConfirmationRequestSchema = {
  type: "object",
  required: ["studentId"],
  properties: {
    studentId: { type: "string", minLength: 1, maxLength: 100 },
    expectedRevision: { type: "integer", minimum: 0 },
  },
  additionalProperties: false,
} as const;
const lessonItemParamsSchema = {
  type: "object",
  required: ["lessonItemId"],
  properties: {
    lessonItemId: { type: "string", minLength: 1, maxLength: 200, pattern: "^[a-z0-9][a-z0-9:-]*$" },
  },
  additionalProperties: false,
} as const;
const legacySubjectCode = "math-logarithm";

type CatalogSearchQuery = {
  query: string;
  limit?: number;
};
type TeacherMessageRequest = {
  studentId?: string;
  subjectCode?: string;
  message: string;
};

type LessonFeedbackRequest = {
  studentId?: string;
  subjectCode?: string;
  lessonId: string;
  understandingLevel: number;
  focusLevel: number;
};

type CurriculumSelectionRequest = {
  studentId?: string;
  subjectCode?: string;
  curriculumId: string;
};

type CurriculumRecommendationRequest = CurriculumRecommendationInput;
type CurriculumToolApiRequest = { tool: CurriculumToolName; input?: CurriculumToolInput };
type ProgressToolApiRequest = { tool: ProgressToolName; input?: ProgressToolInput };

type StudentQuery = {
  studentId?: string;
  subjectCode?: string;
};

type AdjustmentConfirmationRequest = {
  studentId?: string;
  subjectCode?: string;
  expectedRevision?: number;
};

type LearningScope = {
  studentId: string;
  subjectCode: string;
};

type ProgressServiceResolver = (subjectCode: string) => ProgressService;

type AppDependencies = {
  learningPlanRepository?: LearningPlanRepository;
  learningPlanStudentDirectory?: LearningPlanStudentDirectory;
  chatService?: ChatService;
  teacherLlmService?: TeacherLlmService;
  progressService?: ProgressService;
  courseCatalogRepository?: CourseCatalogRepository;
  curriculumRecommendationService?: CurriculumRecommendationService;
  curriculumToolService?: CurriculumToolService;
  progressToolService?: ProgressToolService;
  studentCurriculumRepository?: StudentCurriculumRepository;
  subjectEnrollmentProposalRepository?: SubjectEnrollmentProposalRepository;
  progressServiceResolver?: ProgressServiceResolver;
};

export function buildApp({
  learningPlanRepository,
  learningPlanStudentDirectory,
  chatService,
  teacherLlmService = createTeacherLlmService(),
  progressService = createMemoryProgressService(),
  courseCatalogRepository = createFileCourseCatalogRepository(),
  curriculumRecommendationService,
  curriculumToolService,
  progressToolService,
  studentCurriculumRepository,
  subjectEnrollmentProposalRepository,
  progressServiceResolver,
}: AppDependencies = {}) {
  const app = Fastify({ logger: true, disableRequestLogging: true, ajv: { customOptions: { removeAdditional: false } } });
  registerLearningPlanRoutes(app, learningPlanRepository);
  registerChatRoutes(app, chatService, { directory: learningPlanStudentDirectory, catalog: courseCatalogRepository,
    planService: learningPlanRepository ? createLearningPlanService(learningPlanRepository) : undefined });
  const dataSource = studentCurriculumRepository ? "postgres" : "mock";
  const catalogDataSource = dataSource === "postgres" ? "postgres" : "file";
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof CurriculumSelectionRequiredError) {
      return reply.code(409).send(createSelectionRequiredResponse());
    }
    return reply.send(error);
  });
  const recommendationService =
    curriculumRecommendationService ?? createCurriculumRecommendationService(courseCatalogRepository);
  const subjectEnrollmentService = createSubjectEnrollmentService(
    courseCatalogRepository,
    studentCurriculumRepository,
    subjectEnrollmentProposalRepository,
  );
  const getProgressService = (subjectCode: string) => progressServiceResolver?.(subjectCode) ?? progressService;
  const toolService = curriculumToolService ?? createCurriculumToolService(recommendationService, getProgressService(legacySubjectCode));
  const getProgressTools = (subjectCode: string) => progressToolService ?? createProgressToolService(getProgressService(subjectCode));
  const getCurriculumReadModel = async (scope: LearningScope) =>
    studentCurriculumRepository?.getActiveReadModel(scope.studentId, scope.subjectCode);
  const createLearningSnapshot = async (scope: LearningScope) => ({
    ...(await getProgressService(scope.subjectCode).getProgressSnapshot(scope.studentId)),
    curriculumPlan: scope.subjectCode === legacySubjectCode
      ? (await toolService.getAppliedPlan(scope.studentId))?.recommendation ?? null
      : null,
  });

  app.get("/api/health", async () => ({
    status: "ok",
    service: "ai-homeroom-api",
    dataSource,
  }));

  app.get("/api/course-catalogs", async () => ({
    dataSource,
    catalogDataSource,
    courses: await courseCatalogRepository.listCourses(),
  }));

  app.get<{ Querystring: CatalogSearchQuery }>(
    "/api/learning-catalog/search",
    { schema: { querystring: catalogSearchQuerySchema } },
    async (request) => {
      const normalizedQuery = normalizeCatalogSearchText(request.query.query);
      const courses = await courseCatalogRepository.listCourses();
      const matches = courses
        .map((course) => ({ course, matchFields: getCourseMatchFields(course, normalizedQuery) }))
        .filter((match) => match.matchFields.length > 0)
        .slice(0, request.query.limit ?? 10);

      return {
        dataSource,
        catalogDataSource,
        query: request.query.query,
        matches,
      };
    },
  );
  app.post<{ Body: SubjectEnrollmentProposalInput }>(
    "/api/learning-tools/propose-subject-enrollment",
    { schema: { body: subjectEnrollmentProposalRequestSchema } },
    async (request, reply) => {
      const result = await subjectEnrollmentService.propose(request.body);

      if (result.kind === "course-not-found") {
        return reply.code(404).send({ code: "COURSE_NOT_FOUND", message: "등록 제안에 사용할 강좌를 찾을 수 없습니다." });
      }
      if (result.kind === "course-subject-mismatch") {
        return reply.code(422).send({
          code: "COURSE_SUBJECT_MISMATCH",
          message: "선택한 강좌와 subjectCode 조합은 현재 등록 제안 범위에 맞지 않습니다.",
          course: result.course,
        });
      }
      if (result.kind === "subject-already-enrolled") {
        return reply.code(409).send({
          code: "SUBJECT_ALREADY_ENROLLED",
          message: "이 과목은 이미 등록되어 있어 새 등록 제안을 만들 수 없습니다.",
        });
      }

      return { dataSource, catalogDataSource, proposal: result.proposal };
    },
  );

  app.post<{ Params: { proposalId: string }; Body: Omit<SubjectEnrollmentConfirmationInput, "proposalId"> }>(
    "/api/subject-enrollment-proposals/:proposalId/confirm",
    { schema: { body: subjectEnrollmentConfirmationRequestSchema } },
    async (request, reply) => {
      const result = await subjectEnrollmentService.confirm({ ...request.body, proposalId: request.params.proposalId });
      if (result.kind === "proposal-not-found") return reply.code(404).send({ code: "PROPOSAL_NOT_FOUND", message: "확정할 과목 등록 제안을 찾을 수 없습니다." });
      if (result.kind === "proposal-expired") return reply.code(409).send({ code: "PROPOSAL_EXPIRED", message: "과목 등록 제안의 유효 시간이 지났습니다. 새 제안을 요청해 주세요." });
      if (result.kind === "revision-conflict") return reply.code(409).send({ code: "REVISION_CONFLICT", message: "등록 제안의 기준 revision이 맞지 않습니다.", currentRevision: result.currentRevision });
      if (result.kind === "persistence-unavailable") return reply.code(409).send({ code: "ENROLLMENT_PERSISTENCE_UNAVAILABLE", message: "과목 등록 확정은 PostgreSQL 모드에서만 지원합니다." });
      if (result.kind === "subject-already-enrolled") return reply.code(409).send({ code: "SUBJECT_ALREADY_ENROLLED", message: "이 과목은 이미 등록되어 있어 새 커리큘럼을 만들 수 없습니다." });

      const scope = { studentId: result.curriculum.studentId, subjectCode: result.curriculum.subjectCode };
      request.log.info({ event: "subject_enrollment_confirmed", ...scope, curriculumId: result.curriculum.id }, "과목 등록을 확정했습니다.");
      return { dataSource, catalogDataSource, subjectCode: scope.subjectCode, enrollment: result.curriculum, snapshot: await createLearningSnapshot(scope) };
    },
  );
  app.get<{ Params: { courseId: string } }>("/api/course-catalogs/:courseId", async (request, reply) => {
    const courseCatalog = await courseCatalogRepository.getCourseCatalog(request.params.courseId);

    if (!courseCatalog) {
      return reply.code(404).send({ message: "강좌 카탈로그를 찾을 수 없습니다." });
    }

    return {
      dataSource,
      catalogDataSource,
      courseCatalog,
    };
  });

  app.post<{ Body: CurriculumRecommendationRequest }>(
    "/api/curriculum-recommendations",
    { schema: { body: curriculumRecommendationRequestSchema } },
    async (request, reply) => {
      const result = await recommendationService.recommend(request.body);

      if (result.kind === "course-not-found") {
        return reply.code(404).send({ message: "추천할 강좌 카탈로그를 찾을 수 없습니다." });
      }

      if (result.kind === "no-matching-lessons") {
        return reply.code(422).send({ message: "추천 조건에 맞는 미완료 강의가 없습니다." });
      }

      return {
        dataSource,
        catalogDataSource,
        recommendation: result.recommendation,
      };
    },
  );

  app.post<{ Body: CurriculumToolApiRequest }>(
    "/api/curriculum-tools/execute",
    { schema: { body: curriculumToolRequestSchema } },
    async (request, reply) => {
      const scope = getLearningScope(request.body.input);
      if (scope.subjectCode !== legacySubjectCode) {
        return reply.code(422).send(createLegacyCurriculumToolUnsupportedResponse(scope.subjectCode));
      }
      const result = await toolService.execute({ tool: request.body.tool, input: request.body.input ?? {} });

      if (result.kind === "course-not-found") {
        return reply.code(404).send({ message: "추천할 강의 카탈로그를 찾을 수 없습니다." });
      }

      if (result.kind === "no-matching-lessons") {
        return reply.code(422).send({ message: "도구 실행 조건에 맞는 미완료 강의가 없습니다." });
      }

      return {
        dataSource,
        catalogDataSource,
        subjectCode: scope.subjectCode,
        result: result.result,
        snapshot: request.body.tool === "apply_curriculum_plan" ? await createLearningSnapshot(scope) : null,
      };
    },
  );

  app.get<{ Querystring: StudentQuery }>("/api/curriculum-plans/current", async (request, reply) => {
    const scope = getLearningScope(request.query);
    if (scope.subjectCode !== legacySubjectCode) {
      return reply.code(422).send(createLegacyCurriculumToolUnsupportedResponse(scope.subjectCode));
    }
    const plan = await toolService.getAppliedPlan(scope.studentId);

    if (!plan) {
      return reply.code(404).send({ message: "아직 적용된 커리큘럼 계획이 없습니다." });
    }

    return { dataSource, subjectCode: scope.subjectCode, plan };
  });

  app.post<{ Body: ProgressToolApiRequest }>(
    "/api/progress-tools/execute",
    { schema: { body: progressToolRequestSchema } },
    async (request, reply) => {
      const scope = getLearningScope(request.body.input);
      const result = await getProgressTools(scope.subjectCode).execute({ tool: request.body.tool, input: request.body.input ?? {} });
      request.log.info({ event: "progress_tool_executed", tool: request.body.tool, subjectCode: scope.subjectCode, result: result.kind, revision: await getProgressService(scope.subjectCode).getRevision(scope.studentId) }, "진도 도구를 실행했습니다.");
      if (result.kind === "not-found") return reply.code(404).send({ message: "조정할 현재 학습 항목을 찾을 수 없습니다." });
      return {
        dataSource,
        subjectCode: scope.subjectCode,
        result: result.result,
        snapshot: isStateChangingProgressTool(request.body.tool) ? await createLearningSnapshot(scope) : null,
      };
    },
  );
  app.get<{ Querystring: StudentQuery }>("/api/learning-snapshot", async (request, reply) => {
    const scope = getLearningScope(request.query);
    const curriculumReadModel = await getCurriculumReadModel(scope);
    if (curriculumReadModel?.kind === "selection-required") {
      return reply.code(409).send(createSelectionRequiredResponse());
    }
    return { dataSource, subjectCode: scope.subjectCode, snapshot: await createLearningSnapshot(scope), curriculumReadModel: curriculumReadModel ?? null };
  });
  app.get<{ Querystring: StudentQuery }>("/api/curriculums", async (request) => {
    const scope = getLearningScope(request.query);
    const storedCurriculums = studentCurriculumRepository
      ? (await studentCurriculumRepository.listForStudent(scope.studentId)).filter((curriculum) => curriculum.subjectCode === scope.subjectCode)
      : [];
    if (storedCurriculums.length === 0) {
      return { dataSource, subjectCode: scope.subjectCode, curriculums: await getProgressService(scope.subjectCode).listCurriculums(scope.studentId) };
    }
    return {
      dataSource,
      subjectCode: scope.subjectCode,
      curriculums: storedCurriculums.map((curriculum) => ({
        id: curriculum.id,
        title: curriculum.title,
        pace: curriculum.presentation.paceLabel,
        description: curriculum.presentation.description,
        recommendedFor: curriculum.presentation.recommendedFor,
        teacherComment: curriculum.presentation.teacherComment,
        stepCount: curriculum.currentVersion?.steps.length ?? 0,
        selected: curriculum.status === "active",
        currentStepId: curriculum.status === "active" ? getStoredCurrentStepId(curriculum.state) : null,
      })),
    };
  });

  app.get<{ Querystring: StudentQuery }>("/api/curriculum-read-model", async (request, reply) => {
    if (!studentCurriculumRepository) {
      return reply.code(404).send({ message: "PostgreSQL 커리큘럼 읽기 모델을 사용할 수 없습니다." });
    }
    const scope = getLearningScope(request.query);
    const readModel = await getCurriculumReadModel(scope);
    if (!readModel) {
      return reply.code(404).send({ message: "PostgreSQL 커리큘럼 읽기 모델을 사용할 수 없습니다." });
    }
    if (readModel.kind === "selection-required") {
      return reply.code(409).send(createSelectionRequiredResponse());
    }
    return { dataSource, subjectCode: scope.subjectCode, readModel };
  });

  app.post<{ Body: CurriculumSelectionRequest }>(
    "/api/student-context/curriculum",
    { schema: { body: curriculumSelectionRequestSchema } },
    async (request, reply) => {
      const scope = getLearningScope(request.body);
      const progressService = getProgressService(scope.subjectCode);
      const studentContext = await progressService.selectCurriculum(scope.studentId, request.body.curriculumId);

      if (!studentContext) {
        return reply.code(404).send({ message: "존재하지 않는 커리큘럼입니다." });
      }

      const snapshot = await createLearningSnapshot(scope);
      request.log.info({ event: "curriculum_selection_saved", dataSource, subjectCode: scope.subjectCode, revision: snapshot.revision }, "커리큘럼 선택 상태를 저장했습니다.");

      return {
        dataSource,
        subjectCode: scope.subjectCode,
        studentContext,
        session: await progressService.getTodaySession(scope.studentId),
        curriculumMap: await progressService.getCurriculumMap(scope.studentId),
        snapshot,
      };
    },
  );

  app.get<{ Querystring: StudentQuery }>("/api/student-context", async (request, reply) => {
    const scope = getLearningScope(request.query);
    if ((await getCurriculumReadModel(scope))?.kind === "selection-required") {
      return reply.code(409).send(createSelectionRequiredResponse());
    }
    return { dataSource, subjectCode: scope.subjectCode, studentContext: await getProgressService(scope.subjectCode).getStudentContext(scope.studentId) };
  });

  app.get<{ Querystring: StudentQuery }>("/api/today-session", async (request) => ({
    dataSource,
    subjectCode: getSubjectCode(request.query.subjectCode),
    session: await getProgressService(getSubjectCode(request.query.subjectCode)).getTodaySession(getStudentId(request.query.studentId)),
  }));

  app.get<{ Querystring: StudentQuery }>("/api/today-session/progress", async (request) => ({
    dataSource,
    subjectCode: getSubjectCode(request.query.subjectCode),
    progress: await getProgressService(getSubjectCode(request.query.subjectCode)).getTodaySessionProgress(getStudentId(request.query.studentId)),
  }));

  app.get<{ Querystring: StudentQuery }>("/api/curriculum-map", async (request) => ({
    dataSource,
    subjectCode: getSubjectCode(request.query.subjectCode),
    curriculumMap: await getProgressService(getSubjectCode(request.query.subjectCode)).getCurriculumMap(getStudentId(request.query.studentId)),
  }));

  app.get<{ Params: { lessonItemId: string }; Querystring: StudentQuery }>(
    "/api/lesson-items/:lessonItemId",
    { schema: { params: lessonItemParamsSchema, querystring: studentQuerySchema } },
    async (request, reply) => {
      const lessonItem = await getProgressService(getSubjectCode(request.query.subjectCode)).getLessonItem(
        getStudentId(request.query.studentId),
        request.params.lessonItemId,
      );

      if (!lessonItem) {
        return reply.code(404).send({ message: "현재 커리큘럼에서 강의 항목을 찾을 수 없습니다." });
      }

      return { dataSource, subjectCode: getSubjectCode(request.query.subjectCode), lessonItem };
    },
  );

  app.get<{ Params: { lessonItemId: string }; Querystring: StudentQuery }>(
    "/api/lesson-items/:lessonItemId/playback",
    { schema: { params: lessonItemParamsSchema, querystring: studentQuerySchema } },
    async (request, reply) => {
      const studentId = getStudentId(request.query.studentId);
      const subjectCode = getSubjectCode(request.query.subjectCode);
      const progressService = getProgressService(subjectCode);
      const lessonItem = await progressService.getLessonItem(studentId, request.params.lessonItemId);
      if (!lessonItem) {
        return reply.code(404).send({ code: "LESSON_ITEM_NOT_FOUND", message: "현재 커리큘럼에서 학습 항목을 찾을 수 없습니다." });
      }
      if (lessonItem.kind !== "lecture") {
        return reply.code(404).send({ code: "PLAYBACK_NOT_AVAILABLE", message: "강의가 아닌 학습 항목은 재생할 수 없습니다." });
      }
      const playback = await progressService.getLessonPlayback(studentId, request.params.lessonItemId);

      if (!playback) {
        return reply.code(422).send({ code: "PLAYBACK_NOT_CONFIGURED", message: "이 강의에는 재생 대상이 설정되지 않았습니다." });
      }

      try {
        const media = readMockLessonPlaybackAsset(playback.assetKey);

        if (!media) {
          request.log.error({ assetKey: playback.assetKey }, "등록되지 않은 강의 mock 미디어 자산입니다.");
          return reply.code(500).send({ code: "PLAYBACK_ASSET_MISSING", message: "강의 재생 리소스를 준비하지 못했습니다." });
        }

        return reply.type(playback.contentType).send(media);
      } catch {
        request.log.error({ assetKey: playback.assetKey }, "강의 mock 미디어를 읽지 못했습니다.");
        return reply.code(500).send({ code: "PLAYBACK_ASSET_MISSING", message: "강의 재생 리소스를 준비하지 못했습니다." });
      }
    },
  );

  app.post<{ Params: { conversationId: string }; Body: TeacherMessageRequest }>(
    "/api/conversations/:conversationId/messages",
    { schema: { body: messageRequestSchema } },
    async (request) => {
      const scope = getLearningScope(request.body);
      const llmResponse = await teacherLlmService.generateResponse({
        conversationId: request.params.conversationId,
        message: request.body.message,
      });
      const requestedProgressTool = llmResponse.requestedTools.find(isProgressToolName);
      const progressToolResult = requestedProgressTool
        ? await getProgressTools(scope.subjectCode).execute({ tool: requestedProgressTool, input: { studentId: scope.studentId, message: request.body.message } })
        : undefined;
      const adjustmentProposal = requestedProgressTool === "adjust_today_session" && progressToolResult?.kind === "success"
        ? progressToolResult.result
        : undefined;
      const requestedCurriculumTool = llmResponse.requestedTools.find(isCurriculumToolName);
      const toolResult = requestedCurriculumTool && scope.subjectCode === legacySubjectCode
        ? await toolService.execute({ tool: requestedCurriculumTool, input: { studentId: scope.studentId } })
        : undefined;
      request.log.info({ event: "llm_tool_selection", subjectCode: scope.subjectCode, progressTool: requestedProgressTool ?? null, curriculumTool: requestedCurriculumTool ?? null, revision: await getProgressService(scope.subjectCode).getRevision(scope.studentId) }, "LLM 도구 요청을 처리했습니다.");

      return {
        dataSource,
        subjectCode: scope.subjectCode,
        conversationId: request.params.conversationId,
        ...llmResponse,
        attachment: adjustmentProposal
          ? { type: "session-adjustment", data: adjustmentProposal }
          : null,
        toolCalls: [
          ...(progressToolResult?.kind === "success" && requestedProgressTool
            ? [{ name: requestedProgressTool, result: progressToolResult.result }]
            : []),
          ...(toolResult?.kind === "success" && requestedCurriculumTool
            ? [{ name: requestedCurriculumTool, result: toolResult.result }]
            : []),
        ],
      };
    },
  );

  app.post<{ Params: { adjustmentId: string }; Body: AdjustmentConfirmationRequest }>(
    "/api/session-adjustments/:adjustmentId/confirm",
    { schema: { body: adjustmentConfirmationRequestSchema } },
    async (request, reply) => {
      const scope = getLearningScope(request.body);
      const result = await getProgressService(scope.subjectCode).confirmAdjustment(
        scope.studentId,
        request.params.adjustmentId,
        request.body.expectedRevision,
      );

      if (!result) {
        return reply.code(404).send({ message: "확인할 수 없는 조율 제안입니다." });
      }

      if (result.kind === "revision-conflict") {
        return reply.code(409).send({
          dataSource,
          message: "조율 제안을 만든 뒤 학습 상태가 변경되었습니다. 최신 상태에서 다시 제안해 주세요.",
          ...result,
          subjectCode: scope.subjectCode,
          snapshot: await createLearningSnapshot(scope),
        });
      }

      const snapshot = await createLearningSnapshot(scope);
      request.log.info({ event: "session_adjustment_confirmed", dataSource, subjectCode: scope.subjectCode, revision: snapshot.revision }, "조율 제안을 확정했습니다.");
      return { dataSource, subjectCode: scope.subjectCode, ...result, snapshot };
    },
  );

  app.post<{ Body: LessonFeedbackRequest }>(
    "/api/lesson-feedback",
    { schema: { body: lessonFeedbackRequestSchema } },
    async (request, reply) => {
      const scope = getLearningScope(request.body);
      const feedbackResult = await getProgressService(scope.subjectCode).recordLessonFeedback(
        scope.studentId,
        request.body.lessonId,
        request.body.understandingLevel,
        request.body.focusLevel,
      );

      if (!feedbackResult) {
        return reply.code(404).send({ message: "현재 커리큘럼에서 강의 항목을 찾을 수 없습니다." });
      }

      const snapshot = await createLearningSnapshot(scope);
      request.log.info({ event: "lesson_feedback_saved", dataSource, subjectCode: scope.subjectCode, revision: snapshot.revision }, "강의별 학습 결과를 저장했습니다.");

      return {
        dataSource,
        subjectCode: scope.subjectCode,
        ...feedbackResult,
        snapshot,
      };
    },
  );

  return app;
}

function normalizeCatalogSearchText(value: string) {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase("ko-KR");
}

function getCourseMatchFields(course: CourseCatalogCourse, normalizedQuery: string) {
  const fields: Array<[string, string]> = [
    ["title", course.title],
    ["primarySubject", course.primarySubject],
    ["includedSubject", course.includedSubjects.join(" ")],
    ["instructor", course.instructor.name],
    ["provider", course.provider.name],
  ];
  return fields
    .filter(([, value]) => normalizeCatalogSearchText(value).includes(normalizedQuery))
    .map(([field]) => field);
}
function createLegacyCurriculumToolUnsupportedResponse(subjectCode: string) {
  return {
    code: "CURRICULUM_TOOL_SUBJECT_NOT_SUPPORTED",
    message: "현재 커리큘럼 계획 도구는 수학 로그함수 전환 범위에서만 사용할 수 있습니다.",
    subjectCode,
  };
}
function getLearningScope(input: { studentId?: string; subjectCode?: string } | undefined): LearningScope {
  return { studentId: getStudentId(input?.studentId), subjectCode: getSubjectCode(input?.subjectCode) };
}

function getSubjectCode(subjectCode: string | undefined): string {
  return subjectCode?.trim() || legacySubjectCode;
}

function getStudentId(studentId: string | undefined): string {
  return studentId?.trim() || "000";
}

function isCurriculumToolName(tool: string): tool is CurriculumToolName {
  return curriculumToolNames.includes(tool as CurriculumToolName);
}
function isProgressToolName(tool: string): tool is ProgressToolName {
  return progressToolNames.includes(tool as ProgressToolName);
}

function isStateChangingProgressTool(tool: ProgressToolName) {
  return tool === "insert_remediation" || tool === "defer_learning_item";
}

function getStoredCurrentStepId(state: Record<string, unknown>) {
  return typeof state.currentStepId === "string" ? state.currentStepId : null;
}

function createSelectionRequiredResponse() {
  return {
    code: "CURRICULUM_SELECTION_REQUIRED",
    message: "학습을 시작할 커리큘럼을 먼저 선택해 주세요.",
  };
}
