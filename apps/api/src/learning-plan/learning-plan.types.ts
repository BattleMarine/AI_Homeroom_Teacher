import type { CourseCatalog, CourseCatalogLesson } from "../course-catalog/course-catalog.types.js";

export const supportedCatalogLessonTypes = ["orientation", "lecture", "mock_exam"] as const;
export type CatalogLessonType = CourseCatalogLesson["lessonType"];

export type LearningPlanCatalogSelection = {
  subjectCode: string;
  catalog: CourseCatalog;
};

/** 실제 카탈로그 식별자·순서·초를 보존한다. 과목 이름에서 선수 관계를 추측하지 않는다. */
export type LearningPlanCatalogItem = {
  lessonId: string;
  subjectCode: string;
  courseId: string;
  sequence: number;
  durationSeconds: number;
  lessonType: CatalogLessonType;
};

export type LearningPlanExcludedItem = LearningPlanCatalogItem & {
  reason: "lesson-type-excluded";
};

/** 날짜 의미와 순서는 호출자가 확정한다. capacitySeconds는 검증할 예정 항목의 한도다. */
export type LearningPlanDayCapacity = {
  date: string;
  capacitySeconds: number;
};

export type LearningPlanAssignment = Pick<LearningPlanCatalogItem,
  "lessonId" | "subjectCode" | "courseId" | "durationSeconds"> & {
  date: string;
  order: number;
};

/** 원본 강의를 복제하지 않는 예정 이어보기 구간. 구간 길이는 끝-시작이다. */
export type LearningPlanSegmentAssignment = LearningPlanAssignment & {
  itemKey: string;
  segmentKey: string;
  startOffsetSeconds: number;
  endOffsetSeconds: number;
};
export type LearningPlanExecutionProgress = { itemKey: string; positionSeconds: number };
export type LearningPlanSchedulableItem = LearningPlanCatalogItem & {
  itemKey: string;
  carryoverSinceDate?: string | null;
};
export type LearningPlanSegmentValidationInput = {
  items: readonly LearningPlanSchedulableItem[];
  days: readonly LearningPlanDayCapacity[];
  assignments: readonly LearningPlanSegmentAssignment[];
  progress: readonly LearningPlanExecutionProgress[];
  dailyUsage?: readonly { studyDate: string; spentSeconds: number }[];
};

export type LearningPlanIssueCode =
  | "INVALID_CATALOG_SELECTION" | "INVALID_LESSON_TYPE_SELECTION"
  | "DUPLICATE_COURSE_ID" | "DUPLICATE_LESSON_ID" | "COURSE_LESSON_MISMATCH"
  | "INVALID_SEQUENCE" | "DUPLICATE_SEQUENCE" | "INVALID_DURATION_SECONDS"
  | "UNSUPPORTED_LESSON_TYPE" | "NO_PLANNABLE_LESSONS" | "UNSAFE_DURATION_TOTAL"
  | "INVALID_REFERENCE_ITEM" | "INVALID_DAY" | "DUPLICATE_DAY" | "INVALID_CAPACITY_SECONDS"
  | "INVALID_COMPLETED_LESSON_ID" | "DUPLICATE_COMPLETED_LESSON_ID"
  | "UNKNOWN_LESSON" | "COMPLETED_LESSON_SCHEDULED" | "DUPLICATE_ASSIGNMENT" | "MISSING_ASSIGNMENT"
  | "UNKNOWN_DATE" | "INVALID_ASSIGNMENT_ORDER" | "DUPLICATE_DATE_ORDER"
  | "ASSIGNMENT_IDENTITY_MISMATCH" | "ASSIGNMENT_DURATION_MISMATCH"
  | "DAY_CAPACITY_EXCEEDED" | "COURSE_ORDER_VIOLATION";

export type LearningPlanIssue = {
  code: LearningPlanIssueCode;
  message: string;
  lessonId?: string;
  courseId?: string;
  date?: string;
  expectedSeconds?: number;
  actualSeconds?: number;
};

export type LearningPlanCatalogNormalizationResult =
  | { kind: "normalized"; items: LearningPlanCatalogItem[]; excludedItems: LearningPlanExcludedItem[];
      totalDurationSeconds: number }
  | { kind: "invalid"; issues: LearningPlanIssue[] };

export type LearningPlanValidationInput = {
  items: readonly LearningPlanCatalogItem[];
  /** 정책 해석이 끝난 날짜 순서. 검증기는 날짜를 파싱하거나 정렬하지 않는다. */
  days: readonly LearningPlanDayCapacity[];
  assignments: readonly LearningPlanAssignment[];
  /** 현재 선택 범위 밖의 과거 완료 ID도 전달할 수 있다. 완료를 다시 배정하지 않는다. */
  completedLessonIds?: readonly string[];
};

export type LearningPlanValidationResult =
  | { kind: "valid"; assignmentCount: number; totalDurationSeconds: number;
      days: Array<LearningPlanDayCapacity & { scheduledSeconds: number }> }
  | { kind: "invalid"; issues: LearningPlanIssue[] };
