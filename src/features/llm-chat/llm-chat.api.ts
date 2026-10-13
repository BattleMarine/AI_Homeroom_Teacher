export type ChatMessage = { role: "user" | "assistant"; content: string };
export type LearningPlanBasis = {
  planId: string | null;
  currentVersionId: string | null;
  planRevision: number;
  completionRevision: number;
  catalogHash: string;
};
export type PlanConditions = {
  startDate: string;
  deadlineDate: string;
  availableSecondsPerDay: number;
  dateOverrides: Array<{ date: string; totalSeconds: number }>;
};
export type PlanAssignment = {
  itemKey: string; segmentKey: string; lessonId: string; courseId: string; subjectCode: string;
  date: string; order: number; startOffsetSeconds: number; endOffsetSeconds: number; durationSeconds: number;
};
export type PlanCandidate = {
  conditions: PlanConditions;
  assignments: PlanAssignment[];
  items: Array<{ itemKey: string; lessonId: string; durationSeconds: number; subjectCode: string }>;
  catalogSnapshot: Array<{ subjectCode: string; catalog: {
    course: { id: string; title: string };
    lessons: Array<{ id: string; title: string }>;
  } }>;
};
export type PlanSnapshot = {
  plan: { planId: string; studentId: string; planRevision: number; completionRevision: number };
  basis: LearningPlanBasis;
  version: { candidate: PlanCandidate; versionNumber: number };
  assignments: PlanAssignment[];
  completions: Array<{ itemKey: string }>;
  progress: Array<{ itemKey: string; positionSeconds: number }>;
  days: Array<{ date: string; totalSeconds: number; spentSeconds: number; scheduledSeconds: number; remainingSeconds: number }>;
  learningView: LearningView;
};

export type LearningFeedback = { understandingLevel: number; focusLevel: number; weakConcepts?: string[]; comment?: string };
export type LearningItem = {
  itemKey: string; lessonId: string; courseId: string; subjectCode: string; durationSeconds: number;
  lessonTitle: string | null; courseTitle: string | null; lectureNumber: number | null; metadataMissing: boolean;
  positionSeconds: number; remainingSeconds: number; completed: boolean; completedAt: string | null;
  feedbackSubmitted: boolean; feedback: LearningFeedback | null; feedbackSubmittedAt: string | null;
};
export type LearningAssignment = PlanAssignment & { lessonTitle: string | null; courseTitle: string | null;
  lectureNumber: number | null; remainingSeconds: number; completed: boolean };
export type LearningDay = PlanSnapshot["days"][number] & { remainingScheduledSeconds: number };
export type LearningView = { todayDate: string; items: LearningItem[]; assignments: LearningAssignment[];
  days: LearningDay[]; today: LearningDay & { inPlanPeriod: boolean; assignments: LearningAssignment[] } };
export type ProgressInput = { itemKey: string; positionSeconds: number; spentSeconds: number };
export type FeedbackInput = { itemKey: string; feedback: LearningFeedback };
export type RecordAttempt = { kind: "progress"; payload: ProgressInput & { idempotencyKey: string } }
  | { kind: "feedback"; payload: FeedbackInput & { idempotencyKey: string } };

export class ChatApiError extends Error {
  constructor(public status: number, public code: string, message: string,
    public details?: { proposalCards: ProposalCard[]; toolResults: ToolResult[]; stateChanged: false }) {
    super(message);
  }
}

export type StudentTarget = { studentId: string; hasLearningPlan: boolean };
export type StudentBinding = { bindingToken: string; studentId: string; expiresAt: string };
export type ProposalCard = {
  proposal: { proposalId: string; studentId: string; targetPlanId: string; expectedBasis: LearningPlanBasis; expiresAt: string };
  candidate: PlanCandidate;
  diff: { affectedDates?: string[]; changedSegmentKeys?: string[]; addedCourseIds?: string[]; removedCourseIds?: string[]; noChange?: boolean };
  warnings: Array<{ code?: string; message?: string } | string>;
};
export type ToolResult = {
  tool: string; kind: string; code?: string; message?: string;
  issues?: Array<{ code?: string; message?: string; date?: string }>;
  alternatives?: Array<{ kind: string; deadlineDate?: string; additionalCapacitySecondsLowerBound?: number }>;
};
export type ChatResponse = { message: ChatMessage; model: string; proposalCards: ProposalCard[]; toolResults: ToolResult[] };

export async function chatRequest<T>(path: string, signal: AbortSignal, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST", signal, cache: "no-store",
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new ChatApiError(response.status,
    typeof data?.code === "string" ? data.code : "REQUEST_FAILED",
    typeof data?.message === "string" ? data.message : "요청에 실패했습니다. 다시 시도해주세요.",
    data?.stateChanged === false && Array.isArray(data.proposalCards) && Array.isArray(data.toolResults)
      ? { proposalCards: data.proposalCards, toolResults: data.toolResults, stateChanged: false } : undefined);
  if (!data || typeof data !== "object") throw new ChatApiError(502, "INVALID_RESPONSE", "올바른 서버 응답을 받지 못했습니다.");
  return data as T;
}
