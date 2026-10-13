import assert from "node:assert/strict";
import test from "node:test";
import { assertLearningPlanDistribution } from "./helpers/learning-plan-distribution-check.js";
import { checkLearningPlanIndependently } from "./helpers/learning-plan-independent-check.js";
const items = Array.from({ length: 24 }, (_, n) => ({ itemKey: `lecture-${n}`, lessonId: `lecture-${n}`, courseId: "course", subjectCode: "subject", sequence: n, durationSeconds: 100, lessonType: "lecture" as const }));
const days = Array.from({ length: 12 }, (_, n) => ({ date: `2026-10-${String(n + 1).padStart(2, "0")}`, capacitySeconds: 400 }));
function input(dates: number[]) {
  const orders = new Map<string, number>();
  const assignments = items.map((item, n) => {
    const date = days[dates[n]].date, order = orders.get(date) ?? 0; orders.set(date, order + 1);
    return { ...item, date, order, segmentKey: `${item.itemKey}:${date}`, startOffsetSeconds: 0, endOffsetSeconds: 100 };
  });
  const value = { items, days, assignments, progress: [] };
  checkLearningPlanIndependently({ catalog: items, items: items.map(item => ({ ...item, positionSeconds: 0 })), segments: assignments, capacities: days, dailyUsage: [] });
  return value;
}
test("구간·상한·순서를 지켜도 앞부분 집중 배치는 분산으로 인정하지 않는다", () => {
  assert.throws(() => assertLearningPlanDistribution(input(items.map((_, n) => Math.floor(n / 4)))), /누적 분량/);
});
test("마지막 강의 하나만 끝날에 옮겨도 앞집중 배치의 품질 실패가 유지된다", () => {
  const dates = items.map((_, n) => n === 23 ? 11 : Math.floor(n / 4));
  assert.throws(() => assertLearningPlanDistribution(input(dates)), /누적 분량/);
});
test("같은 원본·상한의 기간 전체 배치를 독립 측정하고 입력을 수정하지 않는다", () => {
  const value = input(items.map((_, n) => Math.floor(n / 2))), before = structuredClone(value);
  const quality = assertLearningPlanDistribution(value);
  assert.equal(quality.maxPrefixDeviationSeconds, 0); assert.equal(quality.maxEmptyAvailableDays, 0);
  assert.deepEqual(value, before);
});
