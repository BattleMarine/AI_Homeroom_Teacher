import {
  supportedCatalogLessonTypes,
  type LearningPlanCatalogItem,
  type LearningPlanIssue,
  type LearningPlanValidationInput,
  type LearningPlanValidationResult,
} from "./learning-plan.types.js";

/** 배치 엔진을 호출하지 않고 입력 카탈로그의 집합·초·순서와 예정 일정을 대조한다. */
export function validateLearningPlan(input: LearningPlanValidationInput): LearningPlanValidationResult {
  const issues: LearningPlanIssue[] = [];
  const items = new Map<string, LearningPlanCatalogItem>();
  const sequences = new Map<string, Set<number>>();
  const supported = new Set<string>(supportedCatalogLessonTypes);
  for (const item of input.items) {
    if (!validId(item.lessonId) || !validId(item.courseId) || !validId(item.subjectCode) ||
      !Number.isSafeInteger(item.sequence) || item.sequence < 0 ||
      !Number.isSafeInteger(item.durationSeconds) || item.durationSeconds <= 0 || !supported.has(item.lessonType)) {
      issues.push({ code: "INVALID_REFERENCE_ITEM", lessonId: item.lessonId, message: "검증 기준 카탈로그 항목이 유효하지 않습니다." });
    }
    if (items.has(item.lessonId)) issues.push({ code: "DUPLICATE_LESSON_ID", lessonId: item.lessonId, message: "검증 기준 강의 ID가 중복됐습니다." });
    items.set(item.lessonId, item);
    const courseSequences = sequences.get(item.courseId) ?? new Set<number>();
    if (courseSequences.has(item.sequence)) issues.push({ code: "DUPLICATE_SEQUENCE", courseId: item.courseId, message: "검증 기준 강좌 순서가 중복됐습니다." });
    courseSequences.add(item.sequence);
    sequences.set(item.courseId, courseSequences);
  }
  const days = new Map<string, { index: number; capacitySeconds: number; scheduledSeconds: number }>();
  input.days.forEach((day, index) => {
    if (!validId(day.date)) issues.push({ code: "INVALID_DAY", message: "정규화된 날짜 키가 필요합니다." });
    if (!Number.isSafeInteger(day.capacitySeconds) || day.capacitySeconds < 0) {
      issues.push({ code: "INVALID_CAPACITY_SECONDS", date: day.date, message: "날짜별 한도는 음수가 아닌 정수 초여야 합니다." });
    }
    if (days.has(day.date)) issues.push({ code: "DUPLICATE_DAY", date: day.date, message: "검증 기준 날짜가 중복됐습니다." });
    days.set(day.date, { index, capacitySeconds: day.capacitySeconds, scheduledSeconds: 0 });
  });
  const completed = new Set<string>();
  for (const id of input.completedLessonIds ?? []) {
    if (!validId(id)) issues.push({ code: "INVALID_COMPLETED_LESSON_ID", message: "완료 강의 ID가 유효하지 않습니다." });
    if (completed.has(id)) issues.push({ code: "DUPLICATE_COMPLETED_LESSON_ID", lessonId: id, message: "완료 강의 ID가 중복됐습니다." });
    completed.add(id);
  }
  if (issues.length) return { kind: "invalid", issues };

  const assigned = new Set<string>();
  const positions = new Map<string, Set<number>>();
  const courses = new Map<string, Array<{ lessonId: string; sequence: number; dayIndex: number; order: number }>>();
  let totalDurationSeconds = 0;
  for (const assignment of input.assignments) {
    const lessonId = assignment.lessonId;
    if (assigned.has(lessonId)) issues.push({ code: "DUPLICATE_ASSIGNMENT", lessonId, message: "강의가 여러 번 배정됐습니다." });
    assigned.add(lessonId);
    const item = items.get(lessonId);
    if (!item) issues.push({ code: "UNKNOWN_LESSON", lessonId, message: "원본 카탈로그에 없는 강의가 배정됐습니다." });
    if (completed.has(lessonId)) issues.push({ code: "COMPLETED_LESSON_SCHEDULED", lessonId, message: "완료한 강의를 다시 배정했습니다." });
    if (item && (assignment.courseId !== item.courseId || assignment.subjectCode !== item.subjectCode)) {
      issues.push({ code: "ASSIGNMENT_IDENTITY_MISMATCH", lessonId, message: "배정 항목의 과목·강좌가 원본과 다릅니다." });
    }
    if (item && assignment.durationSeconds !== item.durationSeconds) issues.push({
      code: "ASSIGNMENT_DURATION_MISMATCH", lessonId, expectedSeconds: item.durationSeconds,
      actualSeconds: assignment.durationSeconds, message: "배정 시간이 실제 카탈로그 초와 다릅니다.",
    });
    const day = days.get(assignment.date);
    if (!day) issues.push({ code: "UNKNOWN_DATE", lessonId, date: assignment.date, message: "허용된 날짜 범위 밖에 배정했습니다." });
    const validOrder = Number.isSafeInteger(assignment.order) && assignment.order >= 0;
    if (!validOrder) issues.push({ code: "INVALID_ASSIGNMENT_ORDER", lessonId, message: "날짜 안의 순서는 음수가 아닌 정수여야 합니다." });
    if (day && validOrder) {
      const dayPositions = positions.get(assignment.date) ?? new Set<number>();
      if (dayPositions.has(assignment.order)) issues.push({ code: "DUPLICATE_DATE_ORDER", date: assignment.date, message: "날짜 안의 항목 순서가 중복됐습니다." });
      dayPositions.add(assignment.order);
      positions.set(assignment.date, dayPositions);
      if (item) {
        const course = courses.get(item.courseId) ?? [];
        course.push({ lessonId, sequence: item.sequence, dayIndex: day.index, order: assignment.order });
        courses.set(item.courseId, course);
      }
    }
    if (item) {
      totalDurationSeconds += item.durationSeconds;
      // 출력 시간을 줄여도 한도 검사를 통과할 수 없도록 실제 카탈로그 시간을 합산한다.
      if (day) day.scheduledSeconds += item.durationSeconds;
    }
  }
  for (const item of items.values()) {
    if (!completed.has(item.lessonId) && !assigned.has(item.lessonId)) {
      issues.push({ code: "MISSING_ASSIGNMENT", lessonId: item.lessonId, message: "미완료 강의가 일정에서 누락됐습니다." });
    }
  }
  for (const [date, day] of days) {
    if (!Number.isSafeInteger(day.scheduledSeconds)) issues.push({ code: "UNSAFE_DURATION_TOTAL", date, message: "날짜별 합계가 안전한 정수 범위를 넘습니다." });
    if (day.scheduledSeconds > day.capacitySeconds) issues.push({ code: "DAY_CAPACITY_EXCEEDED", date,
      expectedSeconds: day.capacitySeconds, actualSeconds: day.scheduledSeconds, message: "과목을 합한 날짜별 시간이 한도를 넘습니다." });
  }
  if (!Number.isSafeInteger(totalDurationSeconds)) issues.push({ code: "UNSAFE_DURATION_TOTAL", message: "일정 전체 시간이 안전한 정수 범위를 넘습니다." });
  for (const [courseId, course] of courses) {
    course.sort((left, right) => left.dayIndex - right.dayIndex || left.order - right.order);
    for (let index = 1; index < course.length; index += 1) {
      if (course[index].sequence <= course[index - 1].sequence) {
        issues.push({ code: "COURSE_ORDER_VIOLATION", courseId, lessonId: course[index].lessonId, message: "강좌의 원본 순서를 거꾸로 배정했습니다." });
      }
    }
  }
  return issues.length ? { kind: "invalid", issues } : { kind: "valid", assignmentCount: input.assignments.length,
    totalDurationSeconds, days: input.days.map((day) => ({ ...day, scheduledSeconds: days.get(day.date)!.scheduledSeconds })) };
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value === value.trim();
}
