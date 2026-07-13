import { getCurriculums, type CurriculumId } from "../features/curriculum";
import type { LearningCheckLevel, LearningCheckSubmission } from "../features/learning-check";
import type { StudentRequestKind } from "../features/progress-orchestrator";

const DEMO_STORAGE_KEY = "ai-homeroom-teacher.demo-state.v1";

const validCurriculumIds = new Set<CurriculumId>(
  getCurriculums().map((curriculum) => curriculum.id),
);

const validStudentRequestKinds = new Set<StudentRequestKind>([
  "default",
  "short_time",
  "review_first",
  "confused_concept",
  "reduce_new_lecture",
]);

export type DemoStorageState = {
  selectedCurriculumId: CurriculumId;
  studentRequestKind: StudentRequestKind;
  learningCheckSubmission: LearningCheckSubmission;
};

export function readDemoStorageState(): Partial<DemoStorageState> | null {
  if (!isLocalStorageAvailable()) {
    return null;
  }

  try {
    const rawValue = window.localStorage.getItem(DEMO_STORAGE_KEY);

    if (!rawValue) {
      return null;
    }

    return normalizeDemoStorageState(JSON.parse(rawValue));
  } catch {
    return null;
  }
}

export function saveDemoStorageState(state: DemoStorageState) {
  if (!isLocalStorageAvailable()) {
    return;
  }

  try {
    window.localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 데모 저장 실패는 핵심 수업 조율 흐름을 막지 않습니다.
  }
}

function normalizeDemoStorageState(value: unknown): Partial<DemoStorageState> | null {
  if (!isRecord(value)) {
    return null;
  }

  const selectedCurriculumId = normalizeCurriculumId(value.selectedCurriculumId);
  const studentRequestKind = normalizeStudentRequestKind(value.studentRequestKind);
  const learningCheckSubmission = normalizeLearningCheckSubmission(
    value.learningCheckSubmission,
  );

  return {
    ...(selectedCurriculumId ? { selectedCurriculumId } : {}),
    ...(studentRequestKind ? { studentRequestKind } : {}),
    ...(learningCheckSubmission ? { learningCheckSubmission } : {}),
  };
}

function normalizeCurriculumId(value: unknown): CurriculumId | null {
  if (typeof value !== "string") {
    return null;
  }

  return validCurriculumIds.has(value as CurriculumId) ? (value as CurriculumId) : null;
}

function normalizeStudentRequestKind(value: unknown): StudentRequestKind | null {
  if (typeof value !== "string") {
    return null;
  }

  return validStudentRequestKinds.has(value as StudentRequestKind)
    ? (value as StudentRequestKind)
    : null;
}

function normalizeLearningCheckSubmission(value: unknown): LearningCheckSubmission | null {
  if (!isRecord(value) || !isRecord(value.problemResult)) {
    return null;
  }

  const understandingLevel = normalizeLearningLevel(value.understandingLevel);
  const focusLevel = normalizeLearningLevel(value.focusLevel);
  const correctCount = normalizeNumber(value.problemResult.correctCount);
  const totalCount = normalizeNumber(value.problemResult.totalCount);

  if (
    typeof value.sessionDate !== "string" ||
    !understandingLevel ||
    !focusLevel ||
    correctCount === null ||
    totalCount === null
  ) {
    return null;
  }

  const safeTotalCount = Math.max(totalCount, 0);

  return {
    sessionDate: value.sessionDate,
    completedItemIds: normalizeStringArray(value.completedItemIds),
    skippedItemIds: normalizeStringArray(value.skippedItemIds),
    understandingLevel,
    focusLevel,
    confusedConcepts: normalizeStringArray(value.confusedConcepts),
    problemResult: {
      correctCount: Math.min(Math.max(correctCount, 0), safeTotalCount),
      totalCount: safeTotalCount,
    },
  };
}

function normalizeLearningLevel(value: unknown): LearningCheckLevel | null {
  return typeof value === "number" && [1, 2, 3, 4, 5].includes(value)
    ? (value as LearningCheckLevel)
    : null;
}

function normalizeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isLocalStorageAvailable() {
  return typeof window !== "undefined" && "localStorage" in window;
}
