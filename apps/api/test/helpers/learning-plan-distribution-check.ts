import assert from "node:assert/strict";
import type { LearningPlanSegmentValidationInput } from "../../src/learning-plan/learning-plan.types.js";

/** 편성기 목표 계산을 재사용하지 않는다. 엄격한 원본/용량 검사는 기존 독립 검사와 함께 실행한다. */
export function measureLearningPlanDistribution(input: LearningPlanSegmentValidationInput) {
  const positions = new Map(input.progress.map(p => [p.itemKey, p.positionSeconds]));
  const items = new Map(input.items.map(item => [item.itemKey, item]));
  const spent = new Map((input.dailyUsage ?? []).map(day => [day.studyDate, day.spentSeconds]));
  const ordinary = input.items.filter(item => !item.carryoverSinceDate && item.durationSeconds > (positions.get(item.itemKey) ?? 0));
  const ordinaryKeys = new Set(ordinary.map(item => item.itemKey));
  const total = ordinary.reduce((sum, item) => sum + item.durationSeconds - (positions.get(item.itemKey) ?? 0), 0);
  const carryByDate = new Map<string, number>();
  const byDate = new Map<string, number>();
  for (const segment of input.assignments) {
    assert.ok(items.has(segment.itemKey));
    const collection = ordinaryKeys.has(segment.itemKey) ? byDate : carryByDate;
    collection.set(segment.date, (collection.get(segment.date) ?? 0) + segment.durationSeconds);
    const item = items.get(segment.itemKey)!;
    if (!item.carryoverSinceDate && segment.endOffsetSeconds < item.durationSeconds) {
      const day = input.days.find(day => day.date === segment.date)!;
      assert.ok(item.durationSeconds - segment.startOffsetSeconds > day.capacitySeconds, "분산 목표만으로 하루에 완강 가능한 강의를 분할했습니다.");
    }
  }
  assert.equal([...byDate.values()].reduce((sum, seconds) => sum + seconds, 0), total, "분산 측정 대상의 잔여 분량이 누락·중복됐습니다.");
  const days = input.days.map(day => ({ date: day.date,
    freeSeconds: Math.max(0, day.capacitySeconds - (spent.get(day.date) ?? 0) - (carryByDate.get(day.date) ?? 0)),
    assignedSeconds: byDate.get(day.date) ?? 0, allAssignedSeconds: input.assignments.filter(s => s.date === day.date).reduce((sum, s) => sum + s.durationSeconds, 0),
  }));
  const capacity = days.reduce((sum, day) => sum + day.freeSeconds, 0);
  const atom = Math.min(Math.max(0, ...ordinary.map(item => item.durationSeconds - (positions.get(item.itemKey) ?? 0))), Math.max(0, ...days.map(day => day.freeSeconds)));
  const prefixToleranceSeconds = 2 * atom;
  let scheduled = 0, available = 0, maxPrefixDeviationSeconds = 0, emptyRun = 0, maxEmptyAvailableDays = 0;
  const daily = days.map(day => {
    scheduled += day.assignedSeconds; available += day.freeSeconds;
    const idealSeconds = capacity ? total * day.freeSeconds / capacity : 0;
    const idealCumulativeSeconds = capacity ? total * available / capacity : 0;
    maxPrefixDeviationSeconds = Math.max(maxPrefixDeviationSeconds, Math.abs(scheduled - idealCumulativeSeconds));
    if (day.freeSeconds > 0) { emptyRun = day.assignedSeconds ? 0 : emptyRun + 1; maxEmptyAvailableDays = Math.max(maxEmptyAvailableDays, emptyRun); }
    return { ...day, idealSeconds, cumulativeSeconds: scheduled, idealCumulativeSeconds };
  });
  const positiveGoals = daily.filter(day => day.idealSeconds > 0).map(day => day.idealSeconds);
  const emptyRunToleranceDays = positiveGoals.length ? Math.ceil(prefixToleranceSeconds / Math.min(...positiveGoals)) + 1 : 0;
  const weekly = [];
  for (let i = 0; i < daily.length; i += 7) {
    const range = daily.slice(i, i + 7);
    weekly.push({ startDate: range[0].date, endDate: range.at(-1)!.date,
      assignedSeconds: range.reduce((sum, day) => sum + day.assignedSeconds, 0),
      idealSeconds: range.reduce((sum, day) => sum + day.idealSeconds, 0),
      allAssignedSeconds: range.reduce((sum, day) => sum + day.allAssignedSeconds, 0) });
  }
  const assignedDates = input.assignments.map(segment => segment.date).sort();
  return { remainingOrdinarySeconds: total, carryoverSeconds: input.assignments.filter(segment => !ordinaryKeys.has(segment.itemKey)).reduce((sum, segment) => sum + segment.durationSeconds, 0),
    granularitySeconds: atom, prefixToleranceSeconds, weeklyToleranceSeconds: 2 * prefixToleranceSeconds, emptyRunToleranceDays,
    maxPrefixDeviationSeconds, maxEmptyAvailableDays, firstAssignedDate: assignedDates[0] ?? null, lastAssignedDate: assignedDates.at(-1) ?? null,
    assignedAvailableDays: daily.filter(day => day.allAssignedSeconds > 0).length, daily, weekly };
}

export function assertLearningPlanDistribution(input: LearningPlanSegmentValidationInput) {
  const quality = measureLearningPlanDistribution(input);
  assert.ok(quality.maxPrefixDeviationSeconds <= quality.prefixToleranceSeconds + 1, "누적 분량이 잔여 용량 비례 목표에서 원본 강의 2단위보다 크게 벗어났습니다.");
  for (const week of quality.weekly) assert.ok(Math.abs(week.assignedSeconds - week.idealSeconds) <= quality.weeklyToleranceSeconds + 1, "주별 배정량 편차가 누적 허용치의 2배를 넘었습니다.");
  if (quality.remainingOrdinarySeconds) assert.ok(quality.maxEmptyAvailableDays <= quality.emptyRunToleranceDays, "학습 가능한 날짜의 연속 공백이 강의 단위로 설명되지 않습니다.");
  return quality;
}
