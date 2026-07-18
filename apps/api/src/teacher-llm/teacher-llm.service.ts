import { createMockTeacherLlmService } from "./teacher-llm.mock.js";
import type { TeacherLlmService } from "./teacher-llm.types.js";

export function createTeacherLlmService(): TeacherLlmService {
  // 실제 공급자 연결 전까지는 같은 계약의 mock 구현을 사용합니다.
  return createMockTeacherLlmService();
}
