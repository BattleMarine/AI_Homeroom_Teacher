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
  const freeByDay = input.days.map((day) => Math.max(0, day.capacitySeconds - (used.get(day.date) ?? 0)));
  const capacity = freeByDay.reduce((sum, seconds) => sum + seconds, 0);
  if (!Number.isSafeInteger(capacity)) throw new LearningPlanInputError("UNSAFE_CAPACITY_TOTAL", "기간의 잔여 용량이 안전한 정수 범위를 넘습니다.");
  const carrySeconds = input.items.filter((item) => item.carryoverSinceDate)
    .reduce((sum, item) => sum + item.durationSeconds - (initial.get(item.itemKey) ?? 0), 0);
  const ordinarySeconds = remainingSeconds - carrySeconds;
  const ordinaryCapacity = capacity - carrySeconds;
  const remainingItems = () => input.items.filter((item) => item.durationSeconds > (initial.get(item.itemKey) ?? 0))
    .map((item) => ({ itemKey: item.itemKey, lessonId: item.lessonId, remainingSeconds: item.durationSeconds - (initial.get(item.itemKey) ?? 0) }));
  if (remainingSeconds > capacity) return { kind: "not-plannable", code: "INSUFFICIENT_CAPACITY", shortageSeconds: remainingSeconds - capacity,
    unassigned: remainingItems(), message: "기간의 실제 잔여 용량이 전체 미수강 초보다 부족합니다." };
  const courses = new Map<string, typeof input.items[number][]>();
  for (const item of input.items) {
    const course = courses.get(item.courseId) ?? []; course.push(item); courses.set(item.courseId, course);
  }
  for (const course of courses.values()) course.sort((a, b) => a.sequence - b.sequence);
  // 이월의 선수 강의도 먼저 풀어야 한다. 원본 이월일 자체를 새 강의에 기록하지는 않는다.
  const carryPriority = new Map<string, string>();
  for (const course of courses.values()) {
    let carryDate: string | undefined;
    for (let i = course.length - 1; i >= 0; i--) {
      const item = course[i];
      if ((initial.get(item.itemKey) ?? 0) >= item.durationSeconds) continue;
      if (item.carryoverSinceDate && (!carryDate || item.carryoverSinceDate < carryDate)) carryDate = item.carryoverSinceDate;
      if (carryDate) carryPriority.set(item.itemKey, carryDate);
    }
  }
  const subjects = [...new Set(input.items.map((item) => item.subjectCode))];
  let best: LearningPlanSegmentAssignment[] | undefined;
  let bestScore = -Infinity;
  let bestDeviation = Infinity;
  let bestTotalDeviation = Infinity;
  let lastPositions = initial;
  // 각 과목의 시작 순서를 바꾸는 작은 제한 탐색. 큰 탐색·정수 최적화 주장은 하지 않는다.
  for (let attempt = 0; attempt < Math.max(1, Math.min(subjects.length, 16)); attempt++) {
    const position = new Map(initial);
    const assignments: LearningPlanSegmentAssignment[] = [];
    const lastSubjectAt = new Map<string, number>();
    let tick = 0;
    let score = 0;
    let prefixCapacity = 0;
    let assignedCarry = 0;
    let assignedOrdinary = 0;
    let maxDeviation = 0;
    let totalDeviation = 0;
    for (let dayIndex = 0; dayIndex < input.days.length; dayIndex++) {
      const day = input.days[dayIndex];
      prefixCapacity += freeByDay[dayIndex];
      let free = freeByDay[dayIndex];
      const futureCapacity = capacity - prefixCapacity;
      // 목표는 계산 중에만 쓰는 유연한 값이며 사용자 총한도·날짜 예외는 바꾸지 않는다.
      const target = () => ordinaryCapacity > 0 ? ordinarySeconds * ((prefixCapacity - assignedCarry) / ordinaryCapacity) : 0;
      const dayCounts = new Map<string, number>();
      let order = 0;
      while (free > 0) {
        const heads = [...courses.values()].map((course) => course.find((item) => (position.get(item.itemKey) ?? 0) < item.durationSeconds))
          .filter((item): item is typeof input.items[number] => !!item);
        const eligible = heads.filter((item) => {
          const rest = item.durationSeconds - (position.get(item.itemKey) ?? 0);
          // 미래의 큰 한도 때문에 오늘의 이어보기·이월을 막지 않는다.
          // 신규 강의는 오늘 총한도를 넘을 때만 분할하고, 단순 자투리 채우기는 하지 않는다.
          if (!(rest <= free || rest > day.capacitySeconds || !!item.carryoverSinceDate)) return false;
          if (carryPriority.has(item.itemKey)) return true;
          // 이미 시작한 예정 구간은 다음 학습 가능일에 이어본다. 실제 부분 수강과 구분한다.
          if ((position.get(item.itemKey) ?? 0) > (initial.get(item.itemKey) ?? 0)) return true;
          if (remainingSeconds - assignedCarry - assignedOrdinary > futureCapacity) return true;
          const goal = target();
          const seconds = Math.min(rest, free);
          // 긴 강의는 오늘 총한도를 기준으로 시작하되 목표를 앞선 동안 새 강의 시작은 기다린다.
          if (rest > day.capacitySeconds) return assignedOrdinary < goal;
          return Math.abs(assignedOrdinary + seconds - goal) <= Math.abs(assignedOrdinary - goal);
        });
        eligible.sort((a, b) => {
          const carry = (carryPriority.get(a.itemKey) ?? "9999-12-31").localeCompare(carryPriority.get(b.itemKey) ?? "9999-12-31");
          if (carry) return carry;
          const continuing = (item: typeof a) => (position.get(item.itemKey) ?? 0) > (initial.get(item.itemKey) ?? 0);
          if (continuing(a) !== continuing(b)) return continuing(a) ? -1 : 1;
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
        if (item.carryoverSinceDate) assignedCarry += seconds;
        else assignedOrdinary += seconds;
        if (!dayCounts.has(item.subjectCode)) score += 1;
        if (lastSubjectAt.has(item.subjectCode) && tick - lastSubjectAt.get(item.subjectCode)! > 1) score += 0.1;
        dayCounts.set(item.subjectCode, (dayCounts.get(item.subjectCode) ?? 0) + 1);
        lastSubjectAt.set(item.subjectCode, tick++);
      }
      const deviation = Math.abs(assignedOrdinary - target());
      maxDeviation = Math.max(maxDeviation, deviation);
      totalDeviation += deviation;
    }
    lastPositions = position;
    if (input.items.some((item) => (position.get(item.itemKey) ?? 0) !== item.durationSeconds)) continue;
    const validation = validateLearningPlanSegments({ ...input, assignments });
    if (validation.kind !== "valid") throw new Error(`편성 결과 독립 검증 실패: ${validation.issues.map((issue) => issue.code).join(",")}`);
    // 기간 분산과 과목 균형은 따로 평가하며 전역 최적화를 보장하지 않는다.
    if (maxDeviation < bestDeviation || (maxDeviation === bestDeviation && (totalDeviation < bestTotalDeviation ||
      (totalDeviation === bestTotalDeviation && score > bestScore)))) {
      best = assignments; bestScore = score; bestDeviation = maxDeviation; bestTotalDeviation = totalDeviation;
    }
  }
  if (best) return { kind: "scheduled", assignments: best, totalDurationSeconds: remainingSeconds,
    warnings: ["카탈로그 강좌 순서만 선수 조건으로 지원합니다. 전역 최적 분산은 보장하지 않습니다."] };
  return { kind: "not-plannable", code: "SEARCH_LIMIT", shortageSeconds: 0,
    unassigned: input.items.filter((item) => (lastPositions.get(item.itemKey) ?? 0) < item.durationSeconds)
      .map((item) => ({ itemKey: item.itemKey, lessonId: item.lessonId, remainingSeconds: item.durationSeconds - (lastPositions.get(item.itemKey) ?? 0) })),
    message: "총량은 충분할 수 있으나 제한된 순환 배치에서 모든 강의를 배치하지 못했습니다. 불가능이 증명된 결과가 아닙니다." };
}
