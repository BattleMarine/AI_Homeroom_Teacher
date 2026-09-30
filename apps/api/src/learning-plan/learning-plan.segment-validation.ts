import type { LearningPlanSegmentValidationInput } from "./learning-plan.types.js";
import { validPlanDate } from "./learning-plan.calendar.js";

type SegmentIssue = { code: string; message: string; itemKey?: string; date?: string };
/** 엔진을 재호출하지 않고 실제 위치부터 원본 끝까지의 연속 커버리지를 독립 검사한다. */
export function validateLearningPlanSegments(input: LearningPlanSegmentValidationInput) {
  const issues: SegmentIssue[] = [];
  const fail = (code: string, message: string, itemKey?: string, date?: string) => issues.push({ code, message, itemKey, date });
  const items = new Map(input.items.map((item) => [item.itemKey, item]));
  const lessons = new Set<string>();
  const sourceSequences = new Set<string>();
  for (const item of input.items) {
    if (!item.itemKey?.trim() || !item.lessonId?.trim() || !item.courseId?.trim() || !item.subjectCode?.trim() ||
      !Number.isSafeInteger(item.durationSeconds) || item.durationSeconds <= 0 || !Number.isSafeInteger(item.sequence) || item.sequence < 0 ||
      !["orientation", "lecture", "mock_exam"].includes(item.lessonType)) fail("INVALID_REFERENCE_ITEM", "원본 항목이 유효하지 않습니다.", item.itemKey);
    if (lessons.has(item.lessonId)) fail("DUPLICATE_LESSON_ID", "같은 강의가 여러 원본 항목에 있습니다.", item.itemKey);
    lessons.add(item.lessonId);
    const identity = JSON.stringify([item.courseId, item.sequence]);
    if (sourceSequences.has(identity)) fail("DUPLICATE_SEQUENCE", "원본 강좌 순서가 중복됐습니다.", item.itemKey);
    sourceSequences.add(identity);
  }
  if (items.size !== input.items.length) fail("DUPLICATE_ITEM_KEY", "원본 항목 키가 중복됐습니다.");
  const days = new Map(input.days.map((day, index) => [day.date, { ...day, index, scheduledSeconds: 0 }]));
  if (days.size !== input.days.length) fail("DUPLICATE_DAY", "날짜가 중복됐습니다.");
  input.days.forEach((day, index) => {
    if (!validPlanDate(day.date) || (index > 0 && input.days[index - 1].date >= day.date)) fail("INVALID_DAY", "날짜 키는 실제 날짜이며 오름차순이어야 합니다.");
    if (!Number.isSafeInteger(day.capacitySeconds) || day.capacitySeconds < 0) fail("INVALID_CAPACITY_SECONDS", "날짜 한도가 유효하지 않습니다.");
  });
  const progress = new Map<string, number>();
  const usage = new Map<string, number>();
  for (const entry of input.dailyUsage ?? []) {
    if (!validPlanDate(entry.studyDate) || !Number.isSafeInteger(entry.spentSeconds) || entry.spentSeconds < 0 || usage.has(entry.studyDate)) {
      fail("INVALID_EXECUTION_USAGE", "일별 실제 소비 초는 중복 없이 유효해야 합니다.");
    }
    usage.set(entry.studyDate, entry.spentSeconds);
  }
  for (const entry of input.progress) {
    const item = items.get(entry.itemKey);
    if (!item || progress.has(entry.itemKey) || !Number.isSafeInteger(entry.positionSeconds) || entry.positionSeconds < 0 || entry.positionSeconds > item.durationSeconds) {
      fail("INVALID_PROGRESS", "현재 항목의 실제 진도는 중복 없이 원본 범위 안이어야 합니다.", entry.itemKey);
    }
    progress.set(entry.itemKey, entry.positionSeconds);
  }
  if (issues.length) return { kind: "invalid" as const, issues };
  const segmentKeys = new Set<string>();
  const orders = new Set<string>();
  const grouped = new Map<string, typeof input.assignments[number][]>();
  for (const segment of input.assignments) {
    const item = items.get(segment.itemKey);
    if (!item) { fail("UNKNOWN_ITEM", "현재 원본에 없는 항목입니다.", segment.itemKey); continue; }
    if (!segment.segmentKey?.trim() || segmentKeys.has(segment.segmentKey)) fail("DUPLICATE_SEGMENT_KEY", "예정 구간 키가 없거나 중복됐습니다.", item.itemKey);
    segmentKeys.add(segment.segmentKey);
    if (segment.lessonId !== item.lessonId || segment.courseId !== item.courseId || segment.subjectCode !== item.subjectCode) fail("ASSIGNMENT_IDENTITY_MISMATCH", "원본 항목 귀속과 다릅니다.", item.itemKey);
    if (![segment.startOffsetSeconds, segment.endOffsetSeconds, segment.durationSeconds].every(Number.isSafeInteger) ||
      segment.startOffsetSeconds < 0 || segment.endOffsetSeconds > item.durationSeconds || segment.startOffsetSeconds >= segment.endOffsetSeconds ||
      segment.durationSeconds !== segment.endOffsetSeconds - segment.startOffsetSeconds) fail("INVALID_SEGMENT_RANGE", "구간 경계·초가 원본 범위와 맞지 않습니다.", item.itemKey);
    const day = days.get(segment.date);
    if (!day) fail("UNKNOWN_DATE", "정규화 날짜 밖의 구간입니다.", item.itemKey, segment.date);
    if (!Number.isSafeInteger(segment.order) || segment.order < 0) fail("INVALID_ASSIGNMENT_ORDER", "날짜 안 순서는 음수가 아닌 정수여야 합니다.", item.itemKey);
    const orderKey = JSON.stringify([segment.date, segment.order]);
    if (orders.has(orderKey)) fail("DUPLICATE_DATE_ORDER", "날짜 안 순서가 중복됐습니다.", item.itemKey, segment.date);
    orders.add(orderKey);
    // 출력 duration이 아니라 경계 차이를 합산한다. 범위 변조는 별도 검사로 거절한다.
    if (day) day.scheduledSeconds += segment.endOffsetSeconds - segment.startOffsetSeconds;
    const group = grouped.get(item.itemKey) ?? []; group.push(segment); grouped.set(item.itemKey, group);
  }
  const chronological = (a: typeof input.assignments[number], b: typeof a) => a.date.localeCompare(b.date) || a.order - b.order;
  for (const item of items.values()) {
    const segments = [...(grouped.get(item.itemKey) ?? [])].sort(chronological);
    let cursor = progress.get(item.itemKey) ?? 0;
    for (const segment of segments) {
      if (segment.startOffsetSeconds !== cursor) fail("SEGMENT_COVERAGE_MISMATCH", "실제 위치 이후 구간에 누락·중복·역행이 있습니다.", item.itemKey);
      cursor = segment.endOffsetSeconds;
    }
    if (cursor !== item.durationSeconds) fail("MISSING_ASSIGNMENT", "실제 미완료 분량이 끝까지 배정되지 않았습니다.", item.itemKey);
  }
  const courses = new Map<string, typeof input.assignments[number][]>();
  for (const segment of input.assignments) {
    if (!items.has(segment.itemKey)) continue;
    const course = courses.get(segment.courseId) ?? []; course.push(segment); courses.set(segment.courseId, course);
  }
  for (const course of courses.values()) {
    course.sort(chronological);
    for (let index = 1; index < course.length; index++) {
      if (items.get(course[index].itemKey)!.sequence < items.get(course[index - 1].itemKey)!.sequence) fail("COURSE_ORDER_VIOLATION", "선수 강의가 뒤에 배정됐습니다.", course[index].itemKey);
    }
  }
  let totalDurationSeconds = 0;
  for (const day of days.values()) {
    if (!Number.isSafeInteger(day.scheduledSeconds) || day.scheduledSeconds > Math.max(0, day.capacitySeconds - (usage.get(day.date) ?? 0))) fail("DAY_CAPACITY_EXCEEDED", "실제 소비를 차감한 날짜 한도를 예정 구간이 넘습니다.", undefined, day.date);
    totalDurationSeconds += day.scheduledSeconds;
  }
  if (!Number.isSafeInteger(totalDurationSeconds)) fail("UNSAFE_DURATION_TOTAL", "전체 예정 초가 안전한 정수 범위를 넘습니다.");
  return issues.length ? { kind: "invalid" as const, issues } : { kind: "valid" as const, assignmentCount: input.assignments.length,
    totalDurationSeconds, days: input.days.map((day) => ({ ...day, scheduledSeconds: days.get(day.date)!.scheduledSeconds })) };
}
