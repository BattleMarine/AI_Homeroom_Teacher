import {
  supportedCatalogLessonTypes,
  type CatalogLessonType,
  type LearningPlanCatalogItem,
  type LearningPlanCatalogNormalizationResult,
  type LearningPlanCatalogSelection,
  type LearningPlanExcludedItem,
  type LearningPlanIssue,
} from "./learning-plan.types.js";

/** 포함 유형은 호출자가 명시한다. 기본 과목·유형·시간을 조용히 채우지 않는다. */
export function normalizeLearningPlanCatalogs(
  selections: readonly LearningPlanCatalogSelection[],
  includedLessonTypes: readonly CatalogLessonType[],
): LearningPlanCatalogNormalizationResult {
  const issues: LearningPlanIssue[] = [];
  const items: LearningPlanCatalogItem[] = [];
  const excludedItems: LearningPlanExcludedItem[] = [];
  const courseIds = new Set<string>();
  const lessonIds = new Set<string>();
  const supported = new Set<string>(supportedCatalogLessonTypes);
  const included = new Set(includedLessonTypes);
  if (!included.size || included.size !== includedLessonTypes.length || includedLessonTypes.some((type) => !supported.has(type))) {
    issues.push({ code: "INVALID_LESSON_TYPE_SELECTION", message: "중복 없이 지원하는 편성 대상 강의 유형을 명시해야 합니다." });
  }
  if (!selections.length) issues.push({ code: "INVALID_CATALOG_SELECTION", message: "선택한 강좌 카탈로그가 없습니다." });

  for (const { subjectCode, catalog } of selections) {
    const courseId = catalog?.course?.id;
    if (!validId(subjectCode) || !validId(courseId) || !Array.isArray(catalog?.lessons)) {
      issues.push({ code: "INVALID_CATALOG_SELECTION", message: "과목·강좌 ID와 강의 목록이 필요합니다." });
      continue;
    }
    if (courseIds.has(courseId)) issues.push({ code: "DUPLICATE_COURSE_ID", courseId, message: "같은 강좌를 중복 선택했습니다." });
    courseIds.add(courseId);
    const sequences = new Set<number>();
    const courseItems: LearningPlanCatalogItem[] = [];
    for (const lesson of catalog.lessons) {
      const lessonId = lesson.id;
      let valid = true;
      const fail = (issue: LearningPlanIssue) => { issues.push({ ...issue, courseId, lessonId }); valid = false; };
      if (!validId(lessonId)) fail({ code: "INVALID_REFERENCE_ITEM", message: "원본 강의 ID가 유효하지 않습니다." });
      if (lessonIds.has(lessonId)) fail({ code: "DUPLICATE_LESSON_ID", message: "원본 강의 ID가 중복됐습니다." });
      lessonIds.add(lessonId);
      if (lesson.courseId !== courseId) fail({ code: "COURSE_LESSON_MISMATCH", message: "강의의 강좌 참조가 선택한 강좌와 다릅니다." });
      if (!Number.isSafeInteger(lesson.sequence) || lesson.sequence < 0) {
        fail({ code: "INVALID_SEQUENCE", message: "원본 강의 순서는 음수가 아닌 안전한 정수여야 합니다." });
      }
      if (sequences.has(lesson.sequence)) fail({ code: "DUPLICATE_SEQUENCE", message: "같은 강좌의 강의 순서가 중복됐습니다." });
      sequences.add(lesson.sequence);
      if (!Number.isSafeInteger(lesson.duration?.seconds) || lesson.duration.seconds <= 0) {
        fail({ code: "INVALID_DURATION_SECONDS", message: "실제 강의 시간은 양의 정수 초여야 합니다." });
      }
      if (!supported.has(lesson.lessonType)) fail({ code: "UNSUPPORTED_LESSON_TYPE", message: "지원하지 않는 카탈로그 강의 유형입니다." });
      if (!valid) continue;
      const item: LearningPlanCatalogItem = { lessonId, subjectCode, courseId, sequence: lesson.sequence,
        durationSeconds: lesson.duration.seconds, lessonType: lesson.lessonType };
      if (included.has(lesson.lessonType)) courseItems.push(item);
      else excludedItems.push({ ...item, reason: "lesson-type-excluded" });
    }
    if (!courseItems.length) issues.push({ code: "NO_PLANNABLE_LESSONS", courseId, message: "선택한 유형의 편성 가능한 강의가 없습니다." });
    items.push(...courseItems.sort((left, right) => left.sequence - right.sequence));
  }
  const totalDurationSeconds = items.reduce((sum, item) => sum + item.durationSeconds, 0);
  if (!Number.isSafeInteger(totalDurationSeconds)) issues.push({ code: "UNSAFE_DURATION_TOTAL", message: "총 강의 시간이 안전한 정수 범위를 넘습니다." });
  return issues.length ? { kind: "invalid", issues } : { kind: "normalized", items, excludedItems, totalDurationSeconds };
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value === value.trim();
}
