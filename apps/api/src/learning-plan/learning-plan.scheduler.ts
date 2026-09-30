import type { LearningPlanSegmentValidationInput, LearningPlanSegmentAssignment } from "./learning-plan.types.js";
import { validateLearningPlanSegments } from "./learning-plan.segment-validation.js";
import { LearningPlanInputError } from "./learning-plan.calendar.js";

export type LearningPlanScheduleResult =
  | { kind: "scheduled"; assignments: LearningPlanSegmentAssignment[]; totalDurationSeconds: number; warnings: string[] }
  | { kind: "not-plannable"; code: "INSUFFICIENT_CAPACITY" | "SEARCH_LIMIT"; shortageSeconds: number;
      unassigned: Array<{ itemKey: string; lessonId: string; remainingSeconds: number }>; message: string };

/** 최초 생성과 전체 재편성이 공유한다. 제한 탐색은 최적해·불가능 증명이 아니다. */
export function scheduleLearningPlan(input: Omit<LearningPlanSegmentValidationInput, "assignments">): LearningPlanScheduleResult {
  const referenceCheck = validateLearningPlanSegments({ ...input, assignments: [] });
  if (referenceCheck.kind === "invalid" && referenceCheck.issues.some((issue) => issue.code !== "MISSING_ASSIGNMENT")) {
    throw new LearningPlanInputError("INVALID_SCHEDULER_INPUT", "카탈로그·실제 진도·총한도 검증 기준이 유효하지 않습니다.");
  }
  const used = new Map((input.dailyUsage ?? []).map((entry) => [entry.studyDate, entry.spentSeconds]));
  const initial = new Map(input.progress.map((entry) => [entry.itemKey, entry.positionSeconds]));
  const remainingSeconds = input.items.reduce((sum, item) => sum + item.durationSeconds - (initial.get(item.itemKey) ?? 0), 0);
  if (!Number.isSafeInteger(remainingSeconds)) throw new LearningPlanInputError("UNSAFE_DURATION_TOTAL", "전체 미수강 초가 안전한 정수 범위를 넘습니다.");
  const capacity = input.days.reduce((sum, day) => sum + Math.max(0, day.capacitySeconds - (used.get(day.date) ?? 0)), 0);
  const remainingItems = () => input.items.filter((item) => item.durationSeconds > (initial.get(item.itemKey) ?? 0))
    .map((item) => ({ itemKey: item.itemKey, lessonId: item.lessonId, remainingSeconds: item.durationSeconds - (initial.get(item.itemKey) ?? 0) }));
  if (remainingSeconds > capacity) return { kind: "not-plannable", code: "INSUFFICIENT_CAPACITY", shortageSeconds: remainingSeconds - capacity,
    unassigned: remainingItems(), message: "기간의 실제 잔여 용량이 전체 미수강 초보다 부족합니다." };
  const courses = new Map<string, typeof input.items[number][]>();
  const futureCapacity = Array<number>(input.days.length + 1).fill(0);
  for (let index = input.days.length - 1; index >= 0; index--) futureCapacity[index] = Math.max(futureCapacity[index + 1],
    Math.max(0, input.days[index].capacitySeconds - (used.get(input.days[index].date) ?? 0)));
  for (const item of input.items) {
    const course = courses.get(item.courseId) ?? []; course.push(item); courses.set(item.courseId, course);
  }
  for (const course of courses.values()) course.sort((a, b) => a.sequence - b.sequence);
  const subjects = [...new Set(input.items.map((item) => item.subjectCode))];
  let best: LearningPlanSegmentAssignment[] | undefined;
  let bestScore = -Infinity;
  let lastPositions = initial;
  // 각 과목의 시작 순서를 바꾸는 작은 제한 탐색. 큰 탐색·정수 최적화 주장은 하지 않는다.
  for (let attempt = 0; attempt < Math.max(1, Math.min(subjects.length, 16)); attempt++) {
    const position = new Map(initial);
    const assignments: LearningPlanSegmentAssignment[] = [];
    const lastSubjectAt = new Map<string, number>();
    let tick = 0;
    let score = 0;
    for (let dayIndex = 0; dayIndex < input.days.length; dayIndex++) {
      const day = input.days[dayIndex];
      let free = Math.max(0, day.capacitySeconds - (used.get(day.date) ?? 0));
      const dayCounts = new Map<string, number>();
      const futureMax = futureCapacity[dayIndex];
      let order = 0;
      while (free > 0) {
        const heads = [...courses.values()].map((course) => course.find((item) => (position.get(item.itemKey) ?? 0) < item.durationSeconds))
          .filter((item): item is typeof input.items[number] => !!item);
        const eligible = heads.filter((item) => {
          const rest = item.durationSeconds - (position.get(item.itemKey) ?? 0);
          // 오늘 자투리나 과목 균형 때문에 쪼개지 않는다. 어느 남은 하루에도 못 들어갈 때만 이어보기.
          return rest <= free || rest > futureMax;
        });
        eligible.sort((a, b) => {
          const carry = (a.carryoverSinceDate ?? "9999-12-31").localeCompare(b.carryoverSinceDate ?? "9999-12-31");
          if (carry) return carry;
          const count = (dayCounts.get(a.subjectCode) ?? 0) - (dayCounts.get(b.subjectCode) ?? 0);
          if (count) return count;
          const recent = (lastSubjectAt.get(a.subjectCode) ?? -1) - (lastSubjectAt.get(b.subjectCode) ?? -1);
          if (recent) return recent;
          return ((subjects.indexOf(a.subjectCode) + attempt) % Math.max(1, subjects.length)) -
            ((subjects.indexOf(b.subjectCode) + attempt) % Math.max(1, subjects.length)) || a.courseId.localeCompare(b.courseId);
        });
        const item = eligible[0];
        if (!item) break;
        const start = position.get(item.itemKey) ?? 0;
        const seconds = Math.min(item.durationSeconds - start, free);
        const end = start + seconds;
        assignments.push({ itemKey: item.itemKey, segmentKey: `${item.itemKey}:${start}:${end}:${day.date}`, lessonId: item.lessonId,
          subjectCode: item.subjectCode, courseId: item.courseId, date: day.date, order: order++,
          startOffsetSeconds: start, endOffsetSeconds: end, durationSeconds: seconds });
        position.set(item.itemKey, end);
        free -= seconds;
        if (!dayCounts.has(item.subjectCode)) score += 1;
        if (lastSubjectAt.has(item.subjectCode) && tick - lastSubjectAt.get(item.subjectCode)! > 1) score += 0.1;
        dayCounts.set(item.subjectCode, (dayCounts.get(item.subjectCode) ?? 0) + 1);
        lastSubjectAt.set(item.subjectCode, tick++);
      }
    }
    lastPositions = position;
    if (input.items.some((item) => (position.get(item.itemKey) ?? 0) !== item.durationSeconds)) continue;
    const validation = validateLearningPlanSegments({ ...input, assignments });
    if (validation.kind !== "valid") throw new Error(`편성 결과 독립 검증 실패: ${validation.issues.map((issue) => issue.code).join(",")}`);
    if (score > bestScore) { best = assignments; bestScore = score; }
  }
  if (best) return { kind: "scheduled", assignments: best, totalDurationSeconds: remainingSeconds,
    warnings: ["카탈로그 강좌 순서만 선수 조건으로 지원합니다. 전역 최적 분산은 보장하지 않습니다."] };
  return { kind: "not-plannable", code: "SEARCH_LIMIT", shortageSeconds: 0,
    unassigned: input.items.filter((item) => (lastPositions.get(item.itemKey) ?? 0) < item.durationSeconds)
      .map((item) => ({ itemKey: item.itemKey, lessonId: item.lessonId, remainingSeconds: item.durationSeconds - (lastPositions.get(item.itemKey) ?? 0) })),
    message: "총량은 충분할 수 있으나 제한된 순환 배치에서 모든 강의를 배치하지 못했습니다. 불가능이 증명된 결과가 아닙니다." };
}
