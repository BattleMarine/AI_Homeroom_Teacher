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
};

export type CurriculumStepStatus =
  | "완료"
  | "진행 중"
  | "예정"
  | "보강 필요"
  | "연기됨";

export type CurriculumStep = {
  id: string;
  title: string;
  conceptTags: string[];
  estimatedMinutes: number;
  status: CurriculumStepStatus;
};

export type TodaySession = {
  goal: string;
  estimatedMinutes: number;
  items: LessonItem[];
  adjustmentReason: string;
  teacherComment: string;
};

export type DemoStudentState = {
  selectedCurriculumId: "stable-log" | "compressed-log" | "practice-log";
  selectedCurriculumTitle: string;
  currentStepId: string;
  currentStepTitle: string;
  weakConcepts: string[];
  completedStepCount: number;
  totalStepCount: number;
  completedStepIds: string[];
  delayedStepIds: string[];
};
