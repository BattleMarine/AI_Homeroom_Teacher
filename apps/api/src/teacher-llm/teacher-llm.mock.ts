import { createMockTeacherMessage } from "../mock/teacher.mock.js";
import type { TeacherLlmService } from "./teacher-llm.types.js";

export function createMockTeacherLlmService(): TeacherLlmService {
  return {
    async generateResponse({ message }) {
      return createMockTeacherMessage(message);
    },
  };
}
