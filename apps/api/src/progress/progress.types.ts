export type CurriculumId = "stable-log" | "compressed-log" | "practice-log";

export type LessonItemKind = "lecture" | "review" | "practice" | "check";

export type MockLessonPlayback = {
  kind: "mock-video";
  targetId: string;
  mediaType: "image";
  contentType: "image/png";
  assetKey: "mock-logarithm-lecture";
  durationSeconds: number;
};

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
  mockPlayback?: MockLessonPlayback;
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
  deferredLessonItemIds: string[];
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

export type RecommendedLearningAction =
  | "play-lesson"
  | "open-review"
  | "start-practice"
  | "start-check";

export type NextRecommendedItem = {
  id: string;
  kind: LessonItemKind;
  title: string;
  action: RecommendedLearningAction;
  playbackAvailable: boolean;
};

export type TodaySessionProgress = {
  sessionId: string;
  completedItemIds: string[];
  completedItemCount: number;
  totalItemCount: number;
  progressPercent: number;
  completedItems: LessonItem[];
  carryOverItems: LessonItem[];
  isCompleted: boolean;
  nextRecommendedItem: NextRecommendedItem | null;
  teacherReport: string;
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
  progress: TodaySessionProgress;
};


export type AdjustmentConfirmationResult =
  | {
      kind: "confirmed";
      adjustmentId: string;
      confirmed: true;
      studentContext: StudentContext;
      session: TodaySession;
      curriculumMap: Record<string, unknown>;
      teacherNote: string;
    }
  | {
      kind: "revision-conflict";
      adjustmentId: string;
      expectedRevision: number;
      currentRevision: number;
    };
export type ProgressService = {
  listCurriculums(studentId: string): Array<Record<string, unknown>>;
  selectCurriculum(studentId: string, curriculumId: string): StudentContext | undefined;
  getStudentContext(studentId: string): StudentContext;
  getTodaySession(studentId: string): TodaySession;
  getCurriculumMap(studentId: string): Record<string, unknown>;
  getLessonItem(studentId: string, lessonItemId: string): Record<string, unknown> | undefined;
  getLessonPlayback(studentId: string, lessonItemId: string): MockLessonPlayback | undefined;
  createAdjustmentProposal(
    studentId: string,
    message: string,
  ): Record<string, unknown> | undefined;
  confirmAdjustment(studentId: string, adjustmentId: string, expectedRevision?: number): AdjustmentConfirmationResult | undefined;
  recordLessonFeedback(
    studentId: string,
    lessonId: string,
    understandingLevel: number,
    focusLevel: number,
  ): LessonFeedbackResult | undefined;
  getTodaySessionProgress(studentId: string): TodaySessionProgress;
  applyCurriculumPlan(studentId: string, plan: CurriculumDefinition): Record<string, unknown>;
  insertRemediation(studentId: string, input: { concept?: string; estimatedMinutes?: number }): Record<string, unknown> | undefined;
  deferLessonItem(studentId: string, lessonItemId?: string): Record<string, unknown> | undefined;
  assessScheduleImpact(
    studentId: string,
    input: { availableMinutesPerDay?: number; targetDays?: number },
  ): Record<string, unknown>;
  getRevision(studentId: string): number;
};
