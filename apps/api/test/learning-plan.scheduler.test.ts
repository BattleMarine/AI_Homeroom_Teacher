import assert from "node:assert/strict";
import test from "node:test";
import { normalizeLearningPlanDays, seoulToday } from "../src/learning-plan/learning-plan.calendar.js";
import { scheduleLearningPlan } from "../src/learning-plan/learning-plan.scheduler.js";
import { validateLearningPlanSegments } from "../src/learning-plan/learning-plan.validation.js";
import type { LearningPlanSchedulableItem, LearningPlanSegmentValidationInput } from "../src/learning-plan/learning-plan.types.js";

function item(subject: string, n: number, seconds: number, carryoverSinceDate?: string): LearningPlanSchedulableItem {
  return { itemKey: `${subject}-${n}`, lessonId: `${subject}-lesson-${n}`, courseId: `${subject}-course`, subjectCode: subject,
    sequence: n, durationSeconds: seconds, lessonType: "lecture", carryoverSinceDate };
}
const days = (count: number, capacity: number) => Array.from({ length: count }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, "0")}`, capacitySeconds: capacity }));
function scheduled(input: Omit<LearningPlanSegmentValidationInput, "assignments">) {
  const result = scheduleLearningPlan(input);
  if (result.kind !== "scheduled") throw new Error(result.message);
  assert.equal(validateLearningPlanSegments({ ...input, assignments: result.assignments }).kind, "valid");
  return result.assignments;
}

test("서울 오늘과 실제 날짜·양끝 포함·총한도는 호스트 시간대와 독립", () => {
  assert.equal(seoulToday(new Date("2026-09-30T15:01:00Z")), "2026-10-01");
  const result = normalizeLearningPlanDays({ startDate: "2026-10-01", deadlineDate: "2026-10-31", availableSecondsPerDay: 3000,
    dateOverrides: [{ date: "2026-10-01", totalSeconds: 2000 }] }, [{ studyDate: "2026-10-01", spentSeconds: 2100 }]);
  assert.equal(result.length, 31);
  assert.equal(result[0].capacitySeconds, 2000);
  assert.throws(() => normalizeLearningPlanDays({ startDate: "2026-02-30", deadlineDate: "2026-03-01", availableSecondsPerDay: 3000, dateOverrides: [] }));
  assert.throws(() => normalizeLearningPlanDays({ startDate: "0000-01-01", deadlineDate: "0000-01-01", availableSecondsPerDay: 1, dateOverrides: [] }));
  assert.equal(normalizeLearningPlanDays({ startDate: "9999-12-31", deadlineDate: "9999-12-31", availableSecondsPerDay: 1, dateOverrides: [] }).length, 1);
});
test("70분 강의는 50분+20분으로 같은 itemKey를 유지", () => {
  const assignments = scheduled({ items: [item("custom", 1, 4200)], days: days(2, 3000), progress: [] });
  assert.deepEqual(assignments.map((a) => [a.itemKey, a.startOffsetSeconds, a.endOffsetSeconds]), [["custom-1", 0, 3000], ["custom-1", 3000, 4200]]);
});
test("실카탈로그 길이4186초의 실제2100초 수강 뒤 미완2086초만 배정", () => {
  const assignments = scheduled({ items: [item("korean", 1, 4186)], days: days(2, 3000), progress: [{ itemKey: "korean-1", positionSeconds: 2100 }],
    dailyUsage: [{ studyDate: "2026-10-01", spentSeconds: 2100 }] });
  assert.deepEqual(assignments.map((a) => [a.startOffsetSeconds, a.endOffsetSeconds, a.date]), [[2100, 4186, "2026-10-02"]]);
});
test("여러 과목을 가능한 날 고르게, 한 강의만 되는 날에는 과목 순환", () => {
  const assignments = scheduled({ items: [item("a", 1, 1000), item("a", 2, 1000), item("b", 1, 1000), item("b", 2, 1000), item("c", 1, 1000), item("c", 2, 1000)], days: days(6, 1000), progress: [] });
  assert.equal(new Set(assignments.slice(0, 3).map((a) => a.subjectCode)).size, 3);
  assert.equal(new Set(assignments.slice(3, 6).map((a) => a.subjectCode)).size, 3);
  const multi = scheduled({ items: [item("a", 1, 1000), item("b", 1, 1000), item("c", 1, 1000)], days: days(1, 3000), progress: [] });
  assert.equal(new Set(multi.map((a) => a.subjectCode)).size, 3);
});
test("신규보다 오래된 이월 먼저, 선수 순서는 이월보다 우선", () => {
  const assignments = scheduled({ items: [item("new", 1, 1000), item("late", 1, 1000, "2026-09-29"), item("old", 1, 1000, "2026-09-20")], days: days(3, 1000), progress: [] });
  assert.deepEqual(assignments.map((a) => a.subjectCode), ["old", "late", "new"]);
  const prerequisite = scheduled({ items: [item("a", 1, 1000), item("a", 2, 1000, "2026-09-01")], days: days(2, 1000), progress: [] });
  assert.deepEqual(prerequisite.map((a) => a.lessonId), ["a-lesson-1", "a-lesson-2"]);
});
test("과목 균형이나 오늘 자투리 때문에 완강 가능한 강의를 나누지 않는다", () => {
  const assignments = scheduled({ items: [item("a", 1, 1800), item("b", 1, 1800)], days: days(2, 3000), progress: [] });
  assert.equal(assignments.length, 2);
  assert.ok(assignments.every((a) => a.startOffsetSeconds === 0 && a.endOffsetSeconds === 1800));
});
test("실제 소비가 총한도보다 크면 예정0, 제거 과목의 사용시간도 차감", () => {
  const assignments = scheduled({ items: [item("a", 1, 1000)], days: days(2, 1000), progress: [], dailyUsage: [{ studyDate: "2026-10-01", spentSeconds: 2000 }] });
  assert.equal(assignments[0].date, "2026-10-02");
});
test("부족 용량은 초 단위 구체 부족량, 제한 탐색 실패는 불가능으로 주장하지 않는다", () => {
  const shortage = scheduleLearningPlan({ items: [item("a", 1, 3001)], days: days(1, 3000), progress: [] });
  assert.equal(shortage.kind, "not-plannable");
  if (shortage.kind === "not-plannable") { assert.equal(shortage.code, "INSUFFICIENT_CAPACITY"); assert.equal(shortage.shortageSeconds, 1); }
  const limit = scheduleLearningPlan({ items: [item("a", 1, 1800), item("b", 1, 1800), item("c", 1, 1800)], days: days(2, 3000), progress: [] });
  assert.equal(limit.kind, "not-plannable");
  if (limit.kind === "not-plannable") assert.equal(limit.code, "SEARCH_LIMIT");
});
test("구간 변조·중복·누락·실제수강 재배정을 독립 거절", () => {
  const base = { items: [item("a", 1, 4200)], days: days(2, 3000), progress: [] };
  const assignments = scheduled(base);
  for (const mutate of [
    (copy: typeof assignments) => { copy[0].durationSeconds--; },
    (copy: typeof assignments) => { copy[1].startOffsetSeconds--; copy[1].durationSeconds++; },
    (copy: typeof assignments) => { copy.pop(); },
    (copy: typeof assignments) => { copy[1].segmentKey = copy[0].segmentKey; },
  ]) { const copy = structuredClone(assignments); mutate(copy); assert.equal(validateLearningPlanSegments({ ...base, assignments: copy }).kind, "invalid"); }
  assert.equal(validateLearningPlanSegments({ ...base, progress: [{ itemKey: "a-1", positionSeconds: 100 }], assignments }).kind, "invalid");
});
test("검증기는 실제 사용시간을 별도 차감하며 미래 선수 역전을 거절", () => {
  const base = { items: [item("a", 1, 1000), item("a", 2, 1000)], days: days(2, 1000), progress: [] };
  const assignments = scheduled(base);
  assert.equal(validateLearningPlanSegments({ ...base, assignments, dailyUsage: [{ studyDate: "2026-10-01", spentSeconds: 1 }] }).kind, "invalid");
  const reversed = structuredClone(assignments); [reversed[0].date, reversed[1].date] = [reversed[1].date, reversed[0].date];
  assert.equal(validateLearningPlanSegments({ ...base, assignments: reversed }).kind, "invalid");
});
test("완료 위치는 다시 배정하지 않고 입력도 변경하지 않는다", () => {
  const input = { items: [item("a", 1, 1000), item("a", 2, 1000)], days: days(1, 1000), progress: [{ itemKey: "a-1", positionSeconds: 1000 }] };
  const copy = structuredClone(input);
  assert.deepEqual(scheduled(input).map((a) => a.itemKey), ["a-2"]);
  assert.deepEqual(input, copy);
});
