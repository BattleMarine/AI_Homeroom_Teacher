import Fastify from "fastify";
import {
  createMockLearningFeedbackResult,
  createMockTeacherMessage,
  mockCurriculumMap,
  mockTodaySession,
} from "./mock/teacher.mock.js";

const messageRequestSchema = {
  type: "object",
  required: ["message"],
  properties: {
    message: { type: "string", minLength: 1, maxLength: 2000 },
  },
  additionalProperties: false,
} as const;

const lessonFeedbackRequestSchema = {
  type: "object",
  required: ["lessonId", "understandingLevel", "focusLevel"],
  properties: {
    lessonId: { type: "string", minLength: 1 },
    understandingLevel: { type: "integer", minimum: 1, maximum: 5 },
    focusLevel: { type: "integer", minimum: 1, maximum: 5 },
  },
  additionalProperties: false,
} as const;

type TeacherMessageRequest = {
  message: string;
};

type LessonFeedbackRequest = {
  lessonId: string;
  understandingLevel: number;
  focusLevel: number;
};

export function buildApp() {
  const app = Fastify({ logger: true });

  app.get("/api/health", async () => ({
    status: "ok",
    service: "ai-homeroom-api",
    dataSource: "mock",
  }));

  app.get("/api/today-session", async () => ({
    dataSource: "mock",
    session: mockTodaySession,
  }));

  app.get("/api/curriculum-map", async () => ({
    dataSource: "mock",
    curriculumMap: mockCurriculumMap,
  }));

  app.post<{ Params: { conversationId: string }; Body: TeacherMessageRequest }>(
    "/api/conversations/:conversationId/messages",
    { schema: { body: messageRequestSchema } },
    async (request) => ({
      dataSource: "mock",
      conversationId: request.params.conversationId,
      ...createMockTeacherMessage(request.body.message),
    }),
  );

  app.post<{ Body: LessonFeedbackRequest }>(
    "/api/lesson-feedback",
    { schema: { body: lessonFeedbackRequestSchema } },
    async (request) => ({
      dataSource: "mock",
      ...createMockLearningFeedbackResult(
        request.body.lessonId,
        request.body.understandingLevel,
        request.body.focusLevel,
      ),
    }),
  );

  return app;
}
