import Fastify from "fastify";
import { createFileCourseCatalogRepository } from "./course-catalog/course-catalog.file-repository.js";
import type { CourseCatalogRepository } from "./course-catalog/course-catalog.types.js";
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
import type { ProgressService } from "./progress/progress.types.js";
import type { StudentCurriculumRepository } from "./student-curriculum/student-curriculum.types.js";
import { createTeacherLlmService } from "./teacher-llm/teacher-llm.service.js";
import type { TeacherLlmService } from "./teacher-llm/teacher-llm.types.js";

const messageRequestSchema = {
  type: "object",
  required: ["message"],
  properties: {
    studentId: { type: "string", minLength: 1, maxLength: 100 },
    message: { type: "string", minLength: 1, maxLength: 2000 },
  },
  additionalProperties: false,
} as const;

const adjustmentConfirmationRequestSchema = {
  type: "object",
  properties: {
    studentId: { type: "string", minLength: 1, maxLength: 100 },
    expectedRevision: { type: "integer", minimum: 0 },
  },
  additionalProperties: false,
} as const;

const lessonFeedbackRequestSchema = {
  type: "object",
  required: ["lessonId", "understandingLevel", "focusLevel"],
  properties: {
    studentId: { type: "string", minLength: 1, maxLength: 100 },
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
  },
  additionalProperties: false,
} as const;

const lessonItemParamsSchema = {
  type: "object",
  required: ["lessonItemId"],
  properties: {
    lessonItemId: { type: "string", minLength: 1, maxLength: 200, pattern: "^[a-z0-9][a-z0-9-]*$" },
  },
  additionalProperties: false,
} as const;
const defaultSubjectCode = "math-logarithm";

type TeacherMessageRequest = {
  studentId?: string;
  message: string;
};

type LessonFeedbackRequest = {
  studentId?: string;
  lessonId: string;
  understandingLevel: number;
  focusLevel: number;
};

type CurriculumSelectionRequest = {
  studentId?: string;
  curriculumId: string;
};

type CurriculumRecommendationRequest = CurriculumRecommendationInput;
type CurriculumToolApiRequest = { tool: CurriculumToolName; input?: CurriculumToolInput };
type ProgressToolApiRequest = { tool: ProgressToolName; input?: ProgressToolInput };

type StudentQuery = {
  studentId?: string;
};

type AdjustmentConfirmationRequest = {
  studentId?: string;
  expectedRevision?: number;
};

type AppDependencies = {
  teacherLlmService?: TeacherLlmService;
  progressService?: ProgressService;
  courseCatalogRepository?: CourseCatalogRepository;
  curriculumRecommendationService?: CurriculumRecommendationService;
  curriculumToolService?: CurriculumToolService;
  progressToolService?: ProgressToolService;
  studentCurriculumRepository?: StudentCurriculumRepository;
};

export function buildApp({
  teacherLlmService = createTeacherLlmService(),
  progressService = createMemoryProgressService(),
  courseCatalogRepository = createFileCourseCatalogRepository(),
  curriculumRecommendationService,
  curriculumToolService,
  progressToolService,
  studentCurriculumRepository,
}: AppDependencies = {}) {
  const app = Fastify({ logger: true });
  const recommendationService =
    curriculumRecommendationService ?? createCurriculumRecommendationService(courseCatalogRepository);
  const toolService = curriculumToolService ?? createCurriculumToolService(recommendationService, progressService);
  const progressTools = progressToolService ?? createProgressToolService(progressService);
  const getCurriculumReadModel = async (studentId: string) =>
    studentCurriculumRepository?.getActiveReadModel(studentId, defaultSubjectCode);
  const createLearningSnapshot = async (studentId: string) => ({
    revision: await progressService.getRevision(studentId),
    studentContext: await progressService.getStudentContext(studentId),
    curriculumPlan: (await toolService.getAppliedPlan(studentId))?.recommendation ?? null,
    todaySession: await progressService.getTodaySession(studentId),
    curriculumMap: await progressService.getCurriculumMap(studentId),
    progress: await progressService.getTodaySessionProgress(studentId),
  });

  app.get("/api/health", async () => ({
    status: "ok",
    service: "ai-homeroom-api",
    dataSource: "mock",
  }));

  app.get("/api/course-catalogs", async () => ({
    dataSource: "mock",
    catalogDataSource: "file",
    courses: await courseCatalogRepository.listCourses(),
  }));

  app.get<{ Params: { courseId: string } }>("/api/course-catalogs/:courseId", async (request, reply) => {
    const courseCatalog = await courseCatalogRepository.getCourseCatalog(request.params.courseId);

    if (!courseCatalog) {
      return reply.code(404).send({ message: "강좌 카탈로그를 찾을 수 없습니다." });
    }

    return {
      dataSource: "mock",
      catalogDataSource: "file",
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
        dataSource: "mock",
        catalogDataSource: "file",
        recommendation: result.recommendation,
      };
    },
  );

  app.post<{ Body: CurriculumToolApiRequest }>(
    "/api/curriculum-tools/execute",
    { schema: { body: curriculumToolRequestSchema } },
    async (request, reply) => {
      const result = await toolService.execute({ tool: request.body.tool, input: request.body.input ?? {} });

      if (result.kind === "course-not-found") {
        return reply.code(404).send({ message: "추천할 강의 카탈로그를 찾을 수 없습니다." });
      }

      if (result.kind === "no-matching-lessons") {
        return reply.code(422).send({ message: "도구 실행 조건에 맞는 미완료 강의가 없습니다." });
      }

      const studentId = getStudentId(request.body.input?.studentId);
      return {
        dataSource: "mock",
        catalogDataSource: "file",
        result: result.result,
        snapshot: request.body.tool === "apply_curriculum_plan" ? await createLearningSnapshot(studentId) : null,
      };
    },
  );

  app.get<{ Querystring: StudentQuery }>("/api/curriculum-plans/current", async (request, reply) => {
    const plan = await toolService.getAppliedPlan(getStudentId(request.query.studentId));

    if (!plan) {
      return reply.code(404).send({ message: "아직 적용된 커리큘럼 계획이 없습니다." });
    }

    return { dataSource: "mock", plan };
  });

  app.post<{ Body: ProgressToolApiRequest }>(
    "/api/progress-tools/execute",
    { schema: { body: progressToolRequestSchema } },
    async (request, reply) => {
      const result = await progressTools.execute({ tool: request.body.tool, input: request.body.input ?? {} });
      request.log.info({ event: "progress_tool_executed", tool: request.body.tool, result: result.kind, revision: await progressService.getRevision(getStudentId(request.body.input?.studentId)) }, "진도 도구를 실행했습니다.");
      if (result.kind === "not-found") return reply.code(404).send({ message: "조정할 현재 학습 항목을 찾을 수 없습니다." });
      const studentId = getStudentId(request.body.input?.studentId);
      return {
        dataSource: "mock",
        result: result.result,
        snapshot: isStateChangingProgressTool(request.body.tool) ? await createLearningSnapshot(studentId) : null,
      };
    },
  );
  app.get<{ Querystring: StudentQuery }>("/api/learning-snapshot", async (request, reply) => {
    const studentId = getStudentId(request.query.studentId);
    const curriculumReadModel = await getCurriculumReadModel(studentId);
    if (curriculumReadModel?.kind === "selection-required") {
      return reply.code(409).send(createSelectionRequiredResponse());
    }
    return { dataSource: "mock", snapshot: await createLearningSnapshot(studentId), curriculumReadModel: curriculumReadModel ?? null };
  });
  app.get<{ Querystring: StudentQuery }>("/api/curriculums", async (request) => {
    const studentId = getStudentId(request.query.studentId);
    const storedCurriculums = studentCurriculumRepository
      ? await studentCurriculumRepository.listForStudent(studentId)
      : [];
    if (storedCurriculums.length === 0) {
      return { dataSource: "mock", curriculums: await progressService.listCurriculums(studentId) };
    }
    return {
      dataSource: "mock",
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
    const readModel = await studentCurriculumRepository.getActiveReadModel(
      getStudentId(request.query.studentId),
      defaultSubjectCode,
    );
    if (readModel.kind === "selection-required") {
      return reply.code(409).send(createSelectionRequiredResponse());
    }
    return { dataSource: "mock", readModel };
  });

  app.post<{ Body: CurriculumSelectionRequest }>(
    "/api/student-context/curriculum",
    { schema: { body: curriculumSelectionRequestSchema } },
    async (request, reply) => {
      const studentId = getStudentId(request.body.studentId);
      const studentContext = await progressService.selectCurriculum(studentId, request.body.curriculumId);

      if (!studentContext) {
        return reply.code(404).send({ message: "존재하지 않는 커리큘럼입니다." });
      }

      return {
        dataSource: "mock",
        studentContext,
        session: await progressService.getTodaySession(studentId),
        curriculumMap: await progressService.getCurriculumMap(studentId),
        snapshot: await createLearningSnapshot(studentId),
      };
    },
  );

  app.get<{ Querystring: StudentQuery }>("/api/student-context", async (request, reply) => {
    const studentId = getStudentId(request.query.studentId);
    if ((await getCurriculumReadModel(studentId))?.kind === "selection-required") {
      return reply.code(409).send(createSelectionRequiredResponse());
    }
    return { dataSource: "mock", studentContext: await progressService.getStudentContext(studentId) };
  });

  app.get<{ Querystring: StudentQuery }>("/api/today-session", async (request) => ({
    dataSource: "mock",
    session: await progressService.getTodaySession(getStudentId(request.query.studentId)),
  }));

  app.get<{ Querystring: StudentQuery }>("/api/today-session/progress", async (request) => ({
    dataSource: "mock",
    progress: await progressService.getTodaySessionProgress(getStudentId(request.query.studentId)),
  }));

  app.get<{ Querystring: StudentQuery }>("/api/curriculum-map", async (request) => ({
    dataSource: "mock",
    curriculumMap: await progressService.getCurriculumMap(getStudentId(request.query.studentId)),
  }));

  app.get<{ Params: { lessonItemId: string }; Querystring: StudentQuery }>(
    "/api/lesson-items/:lessonItemId",
    { schema: { params: lessonItemParamsSchema, querystring: studentQuerySchema } },
    async (request, reply) => {
      const lessonItem = await progressService.getLessonItem(
        getStudentId(request.query.studentId),
        request.params.lessonItemId,
      );

      if (!lessonItem) {
        return reply.code(404).send({ message: "현재 커리큘럼에서 강의 항목을 찾을 수 없습니다." });
      }

      return { dataSource: "mock", lessonItem };
    },
  );

  app.get<{ Params: { lessonItemId: string }; Querystring: StudentQuery }>(
    "/api/lesson-items/:lessonItemId/playback",
    { schema: { params: lessonItemParamsSchema, querystring: studentQuerySchema } },
    async (request, reply) => {
      const playback = await progressService.getLessonPlayback(
        getStudentId(request.query.studentId),
        request.params.lessonItemId,
      );

      if (!playback) {
        return reply.code(404).send({ message: "현재 커리큘럼에서 재생 가능한 강의 항목을 찾을 수 없습니다." });
      }

      try {
        const media = readMockLessonPlaybackAsset(playback.assetKey);

        if (!media) {
          request.log.error({ assetKey: playback.assetKey }, "등록되지 않은 강의 mock 미디어 자산입니다.");
          return reply.code(500).send({ message: "강의 재생 리소스를 준비하지 못했습니다." });
        }

        return reply.type(playback.contentType).send(media);
      } catch {
        request.log.error({ assetKey: playback.assetKey }, "강의 mock 미디어를 읽지 못했습니다.");
        return reply.code(500).send({ message: "강의 재생 리소스를 준비하지 못했습니다." });
      }
    },
  );

  app.post<{ Params: { conversationId: string }; Body: TeacherMessageRequest }>(
    "/api/conversations/:conversationId/messages",
    { schema: { body: messageRequestSchema } },
    async (request) => {
      const studentId = getStudentId(request.body.studentId);
      const llmResponse = await teacherLlmService.generateResponse({
        conversationId: request.params.conversationId,
        message: request.body.message,
      });
      const requestedProgressTool = llmResponse.requestedTools.find(isProgressToolName);
      const progressToolResult = requestedProgressTool
        ? await progressTools.execute({ tool: requestedProgressTool, input: { studentId, message: request.body.message } })
        : undefined;
      const adjustmentProposal = requestedProgressTool === "adjust_today_session" && progressToolResult?.kind === "success"
        ? progressToolResult.result
        : undefined;
      const requestedCurriculumTool = llmResponse.requestedTools.find(isCurriculumToolName);
      const toolResult = requestedCurriculumTool
        ? await toolService.execute({ tool: requestedCurriculumTool, input: { studentId } })
        : undefined;
      request.log.info({ event: "llm_tool_selection", conversationId: request.params.conversationId, progressTool: requestedProgressTool ?? null, curriculumTool: requestedCurriculumTool ?? null, revision: await progressService.getRevision(studentId) }, "LLM 도구 요청을 처리했습니다.");

      return {
        dataSource: "mock",
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
      const studentId = getStudentId(request.body.studentId);
      const result = await progressService.confirmAdjustment(
        studentId,
        request.params.adjustmentId,
        request.body.expectedRevision,
      );

      if (!result) {
        return reply.code(404).send({ message: "확인할 수 없는 조율 제안입니다." });
      }

      if (result.kind === "revision-conflict") {
        return reply.code(409).send({
          dataSource: "mock",
          message: "조율 제안을 만든 뒤 학습 상태가 변경되었습니다. 최신 상태에서 다시 제안해 주세요.",
          ...result,
          snapshot: await createLearningSnapshot(studentId),
        });
      }

      return { dataSource: "mock", ...result, snapshot: await createLearningSnapshot(studentId) };
    },
  );

  app.post<{ Body: LessonFeedbackRequest }>(
    "/api/lesson-feedback",
    { schema: { body: lessonFeedbackRequestSchema } },
    async (request, reply) => {
      const feedbackResult = await progressService.recordLessonFeedback(
        getStudentId(request.body.studentId),
        request.body.lessonId,
        request.body.understandingLevel,
        request.body.focusLevel,
      );

      if (!feedbackResult) {
        return reply.code(404).send({ message: "현재 커리큘럼에서 강의 항목을 찾을 수 없습니다." });
      }

      return {
        dataSource: "mock",
        ...feedbackResult,
        snapshot: await createLearningSnapshot(getStudentId(request.body.studentId)),
      };
    },
  );

  return app;
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
