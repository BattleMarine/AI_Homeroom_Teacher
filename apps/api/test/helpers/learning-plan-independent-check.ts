import assert from "node:assert/strict";

type CatalogRow = { lessonId: string; courseId: string; sequence: number; durationSeconds: number };
type SegmentRow = {
  itemKey: string; segmentKey: string; lessonId: string; courseId: string;
  date: string; order: number; startOffsetSeconds: number; endOffsetSeconds: number; durationSeconds: number;
};
type ItemRow = { itemKey: string; lessonId: string; positionSeconds: number };

/** 제품 편성기·검증기를 호출하지 않고 원본 DB 카탈로그와 결과의 구간·순서·총시간을 대조한다. */
export function checkLearningPlanIndependently(input: {
  catalog: CatalogRow[];
  items: ItemRow[];
  segments: SegmentRow[];
  capacities: Array<{ date: string; capacitySeconds: number }>;
  dailyUsage: Array<{ studyDate: string; spentSeconds: number }>;
}) {
  const catalog = new Map(input.catalog.map((row) => [row.lessonId, row]));
  assert.equal(catalog.size, input.catalog.length, "원본 강의 ID가 중복됐습니다.");
  const items = new Map(input.items.map((row) => [row.itemKey, row]));
  assert.equal(items.size, input.items.length, "현재 항목 key가 중복됐습니다.");
  assert.equal(new Set(input.items.map(({ lessonId }) => lessonId)).size, input.items.length, "원본 강의를 복제했습니다.");
  assert.deepEqual([...input.items.map(({ lessonId }) => lessonId)].sort(), [...catalog.keys()].sort(), "실제 편성 대상 강의가 누락·추가됐습니다.");
  const caps = new Map(input.capacities.map(({ date, capacitySeconds }) => [date, capacitySeconds]));
  assert.equal(caps.size, input.capacities.length);
  const used = new Map(input.dailyUsage.map(({ studyDate, spentSeconds }) => [studyDate, spentSeconds]));
  const scheduled = new Map<string, number>();
  const grouped = new Map<string, SegmentRow[]>();
  const keys = new Set<string>();
  const dayOrder = new Set<string>();
  const ordered = [...input.segments].sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
  for (const row of ordered) {
    const item = items.get(row.itemKey);
    assert.ok(item, "일정에 현재 계획 외 항목이 있습니다.");
    const source = catalog.get(row.lessonId);
    assert.ok(source);
    assert.equal(item.lessonId, row.lessonId);
    assert.equal(source.courseId, row.courseId);
    assert.ok(!keys.has(row.segmentKey), "예정 구간 key가 중복됐습니다.");
    keys.add(row.segmentKey);
    assert.ok(!dayOrder.has(`${row.date}/${row.order}`), "하루 순서가 중복됐습니다.");
    dayOrder.add(`${row.date}/${row.order}`);
    for (const seconds of [row.startOffsetSeconds, row.endOffsetSeconds, row.durationSeconds]) assert.ok(Number.isSafeInteger(seconds));
    assert.ok(row.startOffsetSeconds >= item.positionSeconds, "실제로 수강한 구간을 재배정했습니다.");
    assert.ok(row.endOffsetSeconds <= source.durationSeconds, "원본 강의 길이를 넘었습니다.");
    assert.ok(row.endOffsetSeconds > row.startOffsetSeconds);
    assert.equal(row.durationSeconds, row.endOffsetSeconds - row.startOffsetSeconds);
    assert.ok(caps.has(row.date), "허용된 날짜 밖에 배정했습니다.");
    scheduled.set(row.date, (scheduled.get(row.date) ?? 0) + row.durationSeconds);
    const rows = grouped.get(row.itemKey) ?? [];
    rows.push(row); grouped.set(row.itemKey, rows);
  }
  let remainingSeconds = 0;
  for (const item of input.items) {
    const source = catalog.get(item.lessonId)!;
    assert.ok(Number.isSafeInteger(item.positionSeconds) && item.positionSeconds >= 0 && item.positionSeconds <= source.durationSeconds);
    remainingSeconds += source.durationSeconds - item.positionSeconds;
    let cursor = item.positionSeconds;
    for (const row of grouped.get(item.itemKey) ?? []) {
      assert.equal(row.startOffsetSeconds, cursor, "예정 구간에 중복·빈틈·역순이 있습니다.");
      cursor = row.endOffsetSeconds;
    }
    assert.equal(cursor, source.durationSeconds, "미수강 잔여 구간이 누락됐습니다.");
  }
  for (const [date, seconds] of scheduled) {
    // 과거 실수강이 새 한도보다 많아도 삭제하지 않는다. 신규 배정 가능량은 0이다.
    assert.ok(seconds <= Math.max(0, caps.get(date)! - (used.get(date) ?? 0)), "모든 과목과 실제 진행을 합한 하루 총한도를 넘었습니다.");
  }
  const courseLast = new Map<string, { lessonId: string; sequence: number; endOffsetSeconds: number }>();
  for (const row of ordered) {
    const source = catalog.get(row.lessonId)!;
    const previous = courseLast.get(row.courseId);
    if (previous) {
      assert.ok(source.sequence >= previous.sequence, "강좌 선수 순서를 거슬렀습니다.");
      if (row.lessonId !== previous.lessonId) {
        assert.equal(previous.endOffsetSeconds, catalog.get(previous.lessonId)!.durationSeconds, "이전 강의 종료 전에 다음 강의를 배정했습니다.");
      }
    }
    courseLast.set(row.courseId, { lessonId: row.lessonId, sequence: source.sequence, endOffsetSeconds: row.endOffsetSeconds });
  }
  assert.equal(ordered.reduce((sum, row) => sum + row.durationSeconds, 0), remainingSeconds);
  return { originalLessons: catalog.size, segments: ordered.length, remainingSeconds, assignedDates: scheduled.size };
}
