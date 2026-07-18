export type CurriculumId = "stable-log" | "compressed-log" | "practice-log";

export type LessonItemKind = "lecture" | "review" | "practice" | "check";

export type LessonItem = {
  id: string;
  kind: LessonItemKind;
  title: string;
  description: string;
  conceptTags: string[];
  estimatedMinutes: number;
  required: boolean;
  reason: string;
  playbackTargetId?: string;
};

export type CurriculumStep = {
  id: string;
  title: string;
  goal: string;
  conceptTags: string[];
  estimatedMinutes: number;
  items: LessonItem[];
};

export type CurriculumDefinition = {
  id: CurriculumId;
  title: string;
  pace: "안정형" | "압축형" | "문제적용형";
  description: string;
  recommendedFor: string[];
  teacherComment: string;
  initialProgress: {
    currentStepId: string;
    completedStepIds: string[];
    weakConcepts: string[];
  };
  steps: CurriculumStep[];
};

export type StudentContext = {
  studentId: string;
  selectedCurriculumId: CurriculumId;
  currentStepId: string;
  completedStepIds: string[];
  delayedStepIds: string[];
  weakConcepts: string[];
  completedLessonItemIds: string[];
  lowFocusRecorded: boolean;
  maxSessionMinutes: number;
};

export type StudentRequestKind =
  | "short_time"
  | "review_first"
  | "confused_concept"
  | "reduce_new_lecture";

export type TodaySession = {
  id: string;
  date: string;
  goal: string;
  estimatedMinutes: number;
  items: LessonItem[];
  delayedItems: LessonItem[];
  reasonCodes: string[];
  explanationItems: string[];
  adjustmentReason: string;
  teacherComment: string;
};

export type LessonFeedbackResult = {
  responseType: "mock";
  lessonId: string;
  recorded: true;
  completedLesson: LessonItem;
  appliedFeedback: {
    understandingLevel: number;
    focusLevel: number;
  };
  weakConcepts: string[];
  reasonCodes: string[];
  teacherNote: string;
  progress: Record<string, unknown>;
};

export type ProgressService = {
  listCurriculums(studentId: string): Array<Record<string, unknown>>;
  selectCurriculum(studentId: string, curriculumId: string): StudentContext | undefined;
  getStudentContext(studentId: string): StudentContext;
  getTodaySession(studentId: string): TodaySession;
  getCurriculumMap(studentId: string): Record<string, unknown>;
  getLessonItem(studentId: string, lessonItemId: string): Record<string, unknown> | undefined;
  createAdjustmentProposal(
    studentId: string,
    message: string,
  ): Record<string, unknown> | undefined;
  confirmAdjustment(studentId: string, adjustmentId: string): Record<string, unknown> | undefined;
  recordLessonFeedback(
    studentId: string,
    lessonId: string,
    understandingLevel: number,
    focusLevel: number,
  ): LessonFeedbackResult | undefined;
  getTodaySessionProgress(studentId: string): Record<string, unknown>;
};
