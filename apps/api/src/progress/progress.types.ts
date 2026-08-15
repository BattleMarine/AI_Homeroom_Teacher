export type CurriculumId = string;

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
  pace: string;
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

export type ProgressSnapshot = {
  revision: number;
  studentContext: StudentContext;
  todaySession: TodaySession;
  curriculumMap: Record<string, unknown>;
  progress: TodaySessionProgress;
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
export type PersistedProgressState = {
  studentId: string;
  revision: number;
  context: StudentContext;
  appliedCurriculum: CurriculumDefinition | null;
  remediationItems: LessonItem[];
};

export type PersistedAdjustmentProposal = {
  id: string;
  studentId: string;
  request: {
    kind: StudentRequestKind;
    conditionKinds: StudentRequestKind[];
    summary: string;
    teacherNote: string;
    maxSessionMinutes: number;
    focusConcept?: string;
    currentStepConcepts: string[];
  };
  proposedContext: StudentContext;
  createdAt: string;
  baseRevision: number;
};

export type StatefulProgressService = ProgressService & {
  exportState(studentId: string): PersistedProgressState;
  restoreState(state: PersistedProgressState): void;
  exportAdjustmentProposal(adjustmentId: string): PersistedAdjustmentProposal | undefined;
  restoreAdjustmentProposal(proposal: PersistedAdjustmentProposal): void;
};
type Asyncable<T> = T | Promise<T>;

export type ProgressService = {
  listCurriculums(studentId: string): Asyncable<Array<Record<string, unknown>>>;
  selectCurriculum(studentId: string, curriculumId: string): Asyncable<StudentContext | undefined>;
  getStudentContext(studentId: string): Asyncable<StudentContext>;
  getTodaySession(studentId: string): Asyncable<TodaySession>;
  getCurriculumMap(studentId: string): Asyncable<Record<string, unknown>>;
  getLessonItem(studentId: string, lessonItemId: string): Asyncable<Record<string, unknown> | undefined>;
  getLessonPlayback(studentId: string, lessonItemId: string): Asyncable<MockLessonPlayback | undefined>;
  createAdjustmentProposal(studentId: string, message: string): Asyncable<Record<string, unknown> | undefined>;
  confirmAdjustment(studentId: string, adjustmentId: string, expectedRevision?: number): Asyncable<AdjustmentConfirmationResult | undefined>;
  recordLessonFeedback(studentId: string, lessonId: string, understandingLevel: number, focusLevel: number): Asyncable<LessonFeedbackResult | undefined>;
  getTodaySessionProgress(studentId: string): Asyncable<TodaySessionProgress>;
  applyCurriculumPlan(studentId: string, plan: CurriculumDefinition): Asyncable<Record<string, unknown>>;
  insertRemediation(studentId: string, input: { concept?: string; estimatedMinutes?: number }): Asyncable<Record<string, unknown> | undefined>;
  deferLessonItem(studentId: string, lessonItemId?: string): Asyncable<Record<string, unknown> | undefined>;
  assessScheduleImpact(studentId: string, input: { availableMinutesPerDay?: number; targetDays?: number }): Asyncable<Record<string, unknown>>;
  getRevision(studentId: string): Asyncable<number>;
  getProgressSnapshot(studentId: string): Asyncable<ProgressSnapshot>;
};
