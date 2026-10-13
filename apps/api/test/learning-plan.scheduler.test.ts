import assert from "node:assert/strict";
import test from "node:test";
import { normalizeLearningPlanDays, seoulToday } from "../src/learning-plan/learning-plan.calendar.js";
import { scheduleLearningPlan } from "../src/learning-plan/learning-plan.scheduler.js";
import { validateLearningPlanSegments } from "../src/learning-plan/learning-plan.validation.js";
import type { LearningPlanSchedulableItem, LearningPlanSegmentValidationInput } from "../src/learning-plan/learning-plan.types.js";
import { createFileCourseCatalogRepository } from "../src/course-catalog/course-catalog.file-repository.js";
import { assertLearningPlanDistribution } from "./helpers/learning-plan-distribution-check.js";
import { checkLearningPlanIndependently } from "./helpers/learning-plan-independent-check.js";

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
test("내일 한도가 커도 오늘 50분에 긴 강의를 시작한다", () => {
  const assignments = scheduled({ items: [item("a", 1, 4200)], progress: [],
    days: [{ date: "2026-10-01", capacitySeconds: 3000 }, { date: "2026-10-02", capacitySeconds: 6000 }] });
  assert.deepEqual(assignments.map((a) => [a.date, a.startOffsetSeconds, a.endOffsetSeconds]),
    [["2026-10-01", 0, 3000], ["2026-10-02", 3000, 4200]]);
});
test("날짜별 50분·100분에 70분 강의 두 개를 누락 없이 편성한다", () => {
  const assignments = scheduled({ items: [item("a", 1, 4200), item("b", 1, 4200)], progress: [],
    days: [{ date: "2026-10-01", capacitySeconds: 3000 }, { date: "2026-10-02", capacitySeconds: 6000 }] });
  assert.equal(assignments.filter((a) => a.date === "2026-10-01").reduce((sum, a) => sum + a.durationSeconds, 0), 3000);
  assert.equal(assignments.filter((a) => a.date === "2026-10-02").reduce((sum, a) => sum + a.durationSeconds, 0), 5400);
  for (const key of ["a-1", "b-1"]) assert.equal(assignments.filter((a) => a.itemKey === key).reduce((sum, a) => sum + a.durationSeconds, 0), 4200);
});
test("가변 한도에서 긴 이월을 신규보다 먼저 배정하고 최초 이월일을 보존한다", () => {
  const input = { items: [item("new", 1, 1800), item("old", 1, 4200, "2026-09-20")], progress: [],
    days: [{ date: "2026-10-01", capacitySeconds: 3000 }, { date: "2026-10-02", capacitySeconds: 6000 }] };
  const before = structuredClone(input);
  const assignments = scheduled(input);
  assert.deepEqual(assignments.map((a) => [a.itemKey, a.date, a.durationSeconds]),
    [["old-1", "2026-10-01", 3000], ["old-1", "2026-10-02", 1200], ["new-1", "2026-10-02", 1800]]);
  assert.deepEqual(input, before);
});
test("실제 사용시간 차감 후에도 오래된 이월부터 남은 시간을 쓴다", () => {
  const assignments = scheduled({ items: [item("new", 1, 600), item("late", 1, 1200, "2026-09-29"), item("old", 1, 4200, "2026-09-20")],
    progress: [{ itemKey: "old-1", positionSeconds: 2100 }], dailyUsage: [{ studyDate: "2026-10-01", spentSeconds: 2100 }],
    days: [{ date: "2026-10-01", capacitySeconds: 3000 }, { date: "2026-10-02", capacitySeconds: 6000 }] });
  assert.deepEqual(assignments.map((a) => [a.itemKey, a.date, a.startOffsetSeconds, a.endOffsetSeconds]),
    [["old-1", "2026-10-01", 2100, 3000], ["old-1", "2026-10-02", 3000, 4200],
      ["late-1", "2026-10-02", 0, 1200], ["new-1", "2026-10-02", 0, 600]]);
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

test("기간의 누적 목표로 통강을 분산하고 날짜 상한과 과목 순환은 유지한다", () => {
  const input = { items: [item("a", 1, 1000), item("a", 2, 1000), item("b", 1, 1000), item("b", 2, 1000), item("c", 1, 1000), item("c", 2, 1000)],
    days: days(18, 3000), progress: [] };
  const before = structuredClone(input);
  const assignments = scheduled(input);
  const quality = assertLearningPlanDistribution({ ...input, assignments });
  assert.deepEqual(assignments.map((segment) => segment.date), ["2026-10-02", "2026-10-05", "2026-10-08", "2026-10-11", "2026-10-14", "2026-10-17"]);
  assert.equal(new Set(assignments.slice(0, 3).map((segment) => segment.subjectCode)).size, 3);
  assert.equal(new Set(assignments.slice(3).map((segment) => segment.subjectCode)).size, 3);
  assert.ok(assignments.every((segment) => segment.startOffsetSeconds === 0 && segment.endOffsetSeconds === 1000));
  assert.ok(quality.maxPrefixDeviationSeconds <= 500);
  assert.deepEqual(input, before);
});

test("가변 날짜 여유와 실제 소비에 비례해 분산하고 0시간 날에는 배정하지 않는다", () => {
  const input = { items: ["a", "b", "c"].flatMap((subject) => Array.from({ length: 5 }, (_, i) => item(subject, i + 1, 1000))),
    days: days(12, 3000).map((day, i) => ({ ...day, capacitySeconds: i === 3 || i === 8 ? 0 : i % 3 === 0 ? 1500 : 3000 })),
    progress: [], dailyUsage: [{ studyDate: "2026-10-01", spentSeconds: 1500 }, { studyDate: "2026-10-02", spentSeconds: 500 }] };
  const assignments = scheduled(input);
  const quality = assertLearningPlanDistribution({ ...input, assignments });
  assert.ok(assignments.every((segment) => !["2026-10-01", "2026-10-04", "2026-10-09"].includes(segment.date)));
  assert.ok(quality.daily.find((day) => day.date === "2026-10-07")!.idealSeconds < quality.daily.find((day) => day.date === "2026-10-08")!.idealSeconds);
  assert.equal(assignments.reduce((sum, segment) => sum + segment.durationSeconds, 0), 15000);
});

test("오래된 부분 이월을 앞서 처리한 뒤 일반 잔여만 남은 여유에 분산한다", () => {
  const input = { items: [item("old", 1, 4200, "2026-09-20"), item("late", 1, 1800, "2026-09-29"), item("done", 1, 1000),
      ...["a", "b", "c"].flatMap((subject) => Array.from({ length: 4 }, (_, i) => item(subject, i + 1, 1000)))],
    days: days(10, 3000), progress: [{ itemKey: "old-1", positionSeconds: 2100 }, { itemKey: "done-1", positionSeconds: 1000 }],
    dailyUsage: [{ studyDate: "2026-10-01", spentSeconds: 2100 }] };
  const before = structuredClone(input);
  const assignments = scheduled(input);
  const quality = assertLearningPlanDistribution({ ...input, assignments });
  assert.deepEqual(assignments.slice(0, 3).map((segment) => [segment.itemKey, segment.date, segment.startOffsetSeconds, segment.endOffsetSeconds]),
    [["old-1", "2026-10-01", 2100, 3000], ["old-1", "2026-10-02", 3000, 4200], ["late-1", "2026-10-02", 0, 1800]]);
  assert.ok(assignments.every((segment) => segment.itemKey !== "done-1"));
  assert.equal(quality.carryoverSeconds, 3900); assert.equal(quality.remainingOrdinarySeconds, 12000);
  assert.deepEqual(input, before);
});

test("분산을 기다리느라 이월의 선수 강의를 늦추거나 선수 순서를 뒤집지 않는다", () => {
  const input = { items: [item("new", 1, 1000), item("a", 1, 1000), item("a", 2, 1000, "2026-09-01")],
    days: days(10, 3000), progress: [] };
  const assignments = scheduled(input);
  assert.deepEqual(assignments.slice(0, 2).map((segment) => [segment.itemKey, segment.date]), [["a-1", "2026-10-01"], ["a-2", "2026-10-01"]]);
  assertLearningPlanDistribution({ ...input, assignments });
});

test("긴 강의도 기간 전체에 분산하되 시작한 예정 구간은 다음 가능일에 이어본다", () => {
  const input = { items: ["a", "b"].flatMap((subject) => Array.from({ length: 5 }, (_, i) => item(subject, i + 1, 4200))),
    days: days(23, 3000).map((day, i) => ({ ...day, capacitySeconds: i === 1 ? 0 : day.capacitySeconds })), progress: [] };
  const assignments = scheduled(input);
  const quality = assertLearningPlanDistribution({ ...input, assignments });
  assert.deepEqual(assignments.filter((segment) => segment.itemKey === assignments[0].itemKey).map((segment) => [segment.date, segment.startOffsetSeconds, segment.endOffsetSeconds]),
    [["2026-10-01", 0, 3000], ["2026-10-03", 3000, 4200]]);
  assert.ok(quality.lastAssignedDate! >= "2026-10-21");
  assert.equal(assignments.reduce((sum, segment) => sum + segment.durationSeconds, 0), 42000);
});

test("소수 강의에는 빈 날을 허용하고 목표나 마지막 날 맞추기를 위해 분할하지 않는다", () => {
  const input = { items: [item("a", 1, 1800)], days: days(20, 3000), progress: [] };
  const assignments = scheduled(input);
  assert.deepEqual(assignments.map((segment) => [segment.date, segment.startOffsetSeconds, segment.endOffsetSeconds]), [["2026-10-10", 0, 1800]]);
  assertLearningPlanDistribution({ ...input, assignments });
});

test("안전 범위를 넘는 기간 용량은 유연한 목표 계산 전에 명시 거절한다", () => {
  assert.throws(() => scheduleLearningPlan({ items: [item("a", 1, 1000)], days: days(2, Number.MAX_SAFE_INTEGER), progress: [] }),
    (error: unknown) => error instanceof Error && error.message.includes("안전"));
});

test("실제 EBSi 전체126강의 완료·부분 수강·이월·날짜 예외를 보존하며 분산한다", async () => {
  const repository = createFileCourseCatalogRepository();
  const items: LearningPlanSchedulableItem[] = [];
  const firstByCourse: LearningPlanSchedulableItem[] = [];
  for (const course of await repository.listCourses()) {
    const catalog = (await repository.getCourseCatalog(course.id))!;
    const selected = catalog.lessons.filter((lesson) => lesson.lessonType !== "orientation").map((lesson) => ({
      itemKey: lesson.id, lessonId: lesson.id, courseId: course.id, subjectCode: course.primarySubject,
      sequence: lesson.sequence, durationSeconds: lesson.duration.seconds, lessonType: lesson.lessonType,
    }));
    items.push(...selected); firstByCourse.push(selected[0]);
  }
  assert.equal(items.length, 126); assert.equal(items.reduce((sum, entry) => sum + entry.durationSeconds, 0), 419939);
  const [completed, partial, carry] = firstByCourse;
  carry.carryoverSinceDate = "2026-09-20";
  const input = { items, progress: [{ itemKey: completed.itemKey, positionSeconds: completed.durationSeconds }, { itemKey: partial.itemKey, positionSeconds: 2100 }],
    dailyUsage: [{ studyDate: "2026-10-01", spentSeconds: 2100 }],
    days: normalizeLearningPlanDays({ startDate: "2026-10-01", deadlineDate: "2026-11-12", availableSecondsPerDay: 14400,
      dateOverrides: [{ date: "2026-10-01", totalSeconds: 3000 }, { date: "2026-10-05", totalSeconds: 0 }, { date: "2026-10-10", totalSeconds: 9000 }] }) };
  const before = structuredClone(input);
  const assignments = scheduled(input);
  const quality = assertLearningPlanDistribution({ ...input, assignments });
  const actual = new Map(input.progress.map((entry) => [entry.itemKey, entry.positionSeconds]));
  checkLearningPlanIndependently({ catalog: items, items: items.map((entry) => ({ ...entry, positionSeconds: actual.get(entry.itemKey) ?? 0 })),
    segments: assignments, capacities: input.days, dailyUsage: input.dailyUsage });
  assert.equal(assignments[0].itemKey, carry.itemKey);
  assert.equal(assignments[0].durationSeconds, 900);
  assert.ok(assignments.every((segment) => segment.itemKey !== completed.itemKey && segment.date !== "2026-10-05"));
  assert.equal(assignments.find((segment) => segment.itemKey === partial.itemKey)!.startOffsetSeconds, 2100);
  assert.ok(quality.lastAssignedDate! >= "2026-11-11");
  assert.deepEqual(input, before);
});
