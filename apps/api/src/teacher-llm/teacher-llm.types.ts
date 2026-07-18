export type TeacherLlmTool = "get_student_context" | "adjust_curriculum";

export type TeacherLlmRequest = {
  conversationId: string;
  message: string;
};

export type TeacherLlmResponse = {
  responseType: "mock" | "llm";
  assistantMessage: string;
  requestedTools: TeacherLlmTool[];
};

export type TeacherLlmService = {
  generateResponse(input: TeacherLlmRequest): Promise<TeacherLlmResponse>;
};
