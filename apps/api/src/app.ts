import Fastify from "fastify";
import { createMockProgressService } from "./progress/progress.mock-service.js";
import type { ProgressService } from "./progress/progress.types.js";
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

type StudentQuery = {
  studentId?: string;
};

type AdjustmentConfirmationRequest = {
  studentId?: string;
};

type AppDependencies = {
  teacherLlmService?: TeacherLlmService;
  progressService?: ProgressService;
};

export function buildApp({
  teacherLlmService = createTeacherLlmService(),
  progressService = createMockProgressService(),
}: AppDependencies = {}) {
  const app = Fastify({ logger: true });

  app.get("/api/health", async () => ({
    status: "ok",
    service: "ai-homeroom-api",
    dataSource: "mock",
  }));

  app.get<{ Querystring: StudentQuery }>("/api/curriculums", async (request) => ({
    dataSource: "mock",
    curriculums: progressService.listCurriculums(getStudentId(request.query.studentId)),
  }));

  app.post<{ Body: CurriculumSelectionRequest }>(
    "/api/student-context/curriculum",
    { schema: { body: curriculumSelectionRequestSchema } },
    async (request, reply) => {
      const studentId = getStudentId(request.body.studentId);
      const studentContext = progressService.selectCurriculum(studentId, request.body.curriculumId);

      if (!studentContext) {
        return reply.code(404).send({ message: "존재하지 않는 커리큘럼입니다." });
      }

      return {
        dataSource: "mock",
        studentContext,
        session: progressService.getTodaySession(studentId),
        curriculumMap: progressService.getCurriculumMap(studentId),
      };
    },
  );

  app.get<{ Querystring: StudentQuery }>("/api/student-context", async (request) => ({
    dataSource: "mock",
    studentContext: progressService.getStudentContext(getStudentId(request.query.studentId)),
  }));

  app.get<{ Querystring: StudentQuery }>("/api/today-session", async (request) => ({
    dataSource: "mock",
    session: progressService.getTodaySession(getStudentId(request.query.studentId)),
  }));

  app.get<{ Querystring: StudentQuery }>("/api/today-session/progress", async (request) => ({
    dataSource: "mock",
    progress: progressService.getTodaySessionProgress(getStudentId(request.query.studentId)),
  }));

  app.get<{ Querystring: StudentQuery }>("/api/curriculum-map", async (request) => ({
    dataSource: "mock",
    curriculumMap: progressService.getCurriculumMap(getStudentId(request.query.studentId)),
  }));

  app.get<{ Params: { lessonItemId: string }; Querystring: StudentQuery }>(
    "/api/lesson-items/:lessonItemId",
    async (request, reply) => {
      const lessonItem = progressService.getLessonItem(
        getStudentId(request.query.studentId),
        request.params.lessonItemId,
      );

      if (!lessonItem) {
        return reply.code(404).send({ message: "현재 커리큘럼에서 강의 항목을 찾을 수 없습니다." });
      }

      return { dataSource: "mock", lessonItem };
    },
  );

  app.post<{ Params: { conversationId: string }; Body: TeacherMessageRequest }>(
    "/api/conversations/:conversationId/messages",
    { schema: { body: messageRequestSchema } },
    async (request) => {
      const studentId = getStudentId(request.body.studentId);
      const adjustmentProposal = progressService.createAdjustmentProposal(studentId, request.body.message);
      const llmResponse = await teacherLlmService.generateResponse({
        conversationId: request.params.conversationId,
        message: request.body.message,
      });

      return {
        dataSource: "mock",
        conversationId: request.params.conversationId,
        ...llmResponse,
        attachment: adjustmentProposal
          ? { type: "session-adjustment", data: adjustmentProposal }
          : null,
      };
    },
  );

  app.post<{ Params: { adjustmentId: string }; Body: AdjustmentConfirmationRequest }>(
    "/api/session-adjustments/:adjustmentId/confirm",
    { schema: { body: adjustmentConfirmationRequestSchema } },
    async (request, reply) => {
      const result = progressService.confirmAdjustment(
        getStudentId(request.body.studentId),
        request.params.adjustmentId,
      );

      if (!result) {
        return reply.code(404).send({ message: "확인할 수 없는 조율 제안입니다." });
      }

      return { dataSource: "mock", ...result };
    },
  );

  app.post<{ Body: LessonFeedbackRequest }>(
    "/api/lesson-feedback",
    { schema: { body: lessonFeedbackRequestSchema } },
    async (request, reply) => {
      const feedbackResult = progressService.recordLessonFeedback(
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
      };
    },
  );

  return app;
}

function getStudentId(studentId: string | undefined): string {
  return studentId?.trim() || "demo-student";
}
