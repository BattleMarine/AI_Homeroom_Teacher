import { randomUUID } from "node:crypto";
import { LearningPlanInputError, nextPlanDate, normalizeLearningPlanDays, seoulToday, validPlanDate, type LearningPlanConditions } from "./learning-plan.calendar.js";
import { normalizeLearningPlanCatalogs } from "./learning-plan.catalog.js";
import { scheduleLearningPlan } from "./learning-plan.scheduler.js";
import { validateLearningPlanSegments } from "./learning-plan.validation.js";
import { LearningPlanRepositoryError, type LearningPlanBasis, type LearningPlanCandidate, type LearningPlanJsonObject,
  type LearningPlanReadBasisResult, type LearningPlanRepository, type LearningPlanSelection, type LearningPlanStoredItem } from "./learning-plan.repository.js";

export type CreateLearningPlanInput = {
  studentId: string; selections: LearningPlanSelection[]; startDate?: string; deadlineDate: string;
  availableSecondsPerDay: number; dateOverrides?: Array<{ date: string; totalSeconds: number }>;
};
export type RebalanceLearningPlanInput = {
  studentId: string; planId: string; expectedBasis: LearningPlanBasis; fromDate?: string; selections?: LearningPlanSelection[];
  deadlineDate?: string; availableSecondsPerDay?: number; dateOverrides?: Array<{ date: string; totalSeconds: number }>;
  todayTime?: { mode: "total" | "additional"; seconds: number };
};
export type AdjustLearningPlanInput = { studentId: string; planId: string; expectedBasis: LearningPlanBasis;
  moves: Array<{ segmentKey: string; date: string; order: number }> };

export function createLearningPlanService(repository: LearningPlanRepository, now: () => Date = () => new Date()) {
  const selectionsOf = (snapshot: LearningPlanReadBasisResult["catalogSnapshot"]) => snapshot.map(({ subjectCode, catalog }) => ({ subjectCode, courseId: catalog.course.id }));
  async function current(studentId: string, planId?: string) {
    const read = await repository.readPlan({ studentId, planId });
    if (!read) throw new LearningPlanRepositoryError("NOT_FOUND", "학습 계획이 없습니다.");
    const basis = await repository.readBasis({ studentId, planId: read.plan.planId, selections: selectionsOf(read.version.candidate.catalogSnapshot) });
    if (!basis.plan || read.plan.currentVersionId !== basis.plan.currentVersionId || read.plan.planRevision !== basis.plan.planRevision || read.plan.completionRevision !== basis.plan.completionRevision) {
      throw new LearningPlanRepositoryError("BASIS_CONFLICT", "조회 도중 학습 상태가 변경됐습니다. 다시 조회하세요.");
    }
    return basis;
  }
  function checkBasis(expected: LearningPlanBasis, actual: LearningPlanBasis) {
    if (expected.planId !== actual.planId || expected.currentVersionId !== actual.currentVersionId || expected.planRevision !== actual.planRevision ||
      expected.completionRevision !== actual.completionRevision || expected.catalogHash !== actual.catalogHash) throw new LearningPlanRepositoryError("BASIS_CONFLICT", "계획·진도 또는 카탈로그 기준이 오래됐습니다.");
  }
  function snapshot(basis: LearningPlanReadBasisResult) {
    return { progress: basis.progress.map(({ itemKey, positionSeconds }) => ({ itemKey, positionSeconds })), dailyUsage: basis.dailyUsage.map((entry) => ({ ...entry })) };
  }
  function candidateItems(basis: LearningPlanReadBasisResult, reference?: LearningPlanReadBasisResult, carryDate = seoulToday(now())) {
    for (const selection of basis.catalogSnapshot) {
      if (selection.subjectCode !== selection.catalog.course.primarySubject) throw new LearningPlanInputError("SUBJECT_COURSE_MISMATCH", "선택 과목 식별자는 실제 강좌의 primarySubject와 일치해야 합니다.");
    }
    const normalized = !basis.catalogSnapshot.length && reference
      ? { kind: "normalized" as const, items: [], excludedItems: [], totalDurationSeconds: 0 }
      : normalizeLearningPlanCatalogs(basis.catalogSnapshot, ["lecture", "mock_exam"]);
    if (normalized.kind !== "normalized") throw new LearningPlanInputError("INVALID_CATALOG", normalized.issues.map((issue) => issue.message).join(" "));
    const previous = reference?.version?.candidate;
    const positions = new Map(basis.progress.map((entry) => [entry.itemKey, entry.positionSeconds]));
    const carry = new Map(basis.progress.filter((p) => p.carryoverSinceDate).map((p) => [p.itemKey, p.carryoverSinceDate!]));
    for (const item of previous?.items ?? []) if (item.carryoverSinceDate && !carry.has(item.itemKey)) carry.set(item.itemKey, item.carryoverSinceDate);
    const preservedCarry = new Set(carry.keys());
    for (const assignment of previous?.assignments ?? []) {
      if (!preservedCarry.has(assignment.itemKey) && assignment.date < carryDate && assignment.endOffsetSeconds > (positions.get(assignment.itemKey) ?? 0)) {
        const first = carry.get(assignment.itemKey);
        if (!first || assignment.date < first) carry.set(assignment.itemKey, assignment.date);
      }
    }
    const items = normalized.items.map((item): LearningPlanStoredItem => {
      const prior = previous?.items.find((old) => old.lessonId === item.lessonId && old.courseId === item.courseId);
      if (!prior && basis.historicalItems.some((old) => old.courseId === item.courseId)) {
        throw new LearningPlanInputError("REENROLLMENT_SELECTION_REQUIRED", "제거했던 강좌의 재등록은 이어가기 또는 새로 시작 선택이 필요하며 현재 미지원입니다.");
      }
      if (prior && (prior.durationSeconds !== item.durationSeconds || prior.sequence !== item.sequence || prior.subjectCode !== item.subjectCode || prior.lessonType !== item.lessonType)) {
        throw new LearningPlanInputError("CATALOG_ITEM_CHANGED", "기존 학습 항목의 카탈로그 초·순서·과목이 변경됐습니다. 기록을 임의로 바꾸지 않습니다.");
      }
      const itemKey = prior?.itemKey ?? randomUUID();
      return { ...item, itemKey, carryoverSinceDate: carry.get(itemKey) ?? prior?.carryoverSinceDate ?? null };
    });
    const activeKeys = new Set(items.map((item) => item.itemKey));
    return { items, normalized, carryoverCandidates: [...carry].filter(([key]) => activeKeys.has(key))
      .map(([itemKey, carryoverSinceDate]) => ({ itemKey, carryoverSinceDate })) };
  }
  function planInput(items: LearningPlanStoredItem[], basis: LearningPlanReadBasisResult, conditions: LearningPlanConditions) {
    const keys = new Set(items.map((item) => item.itemKey));
    return { items, days: normalizeLearningPlanDays(conditions, basis.dailyUsage), progress: basis.progress.filter((entry) => keys.has(entry.itemKey)), dailyUsage: basis.dailyUsage };
  }
  async function propose(studentId: string, basis: LearningPlanReadBasisResult, conditions: LearningPlanConditions, kind: "create" | "rebalance", reference?: LearningPlanReadBasisResult) {
    const prepared = candidateItems(basis, reference, seoulToday(now()));
    const input = planInput(prepared.items, basis, conditions);
    const result = scheduleLearningPlan(input);
    if (result.kind !== "scheduled") {
      // 기한 대안도 동일 제약으로 실제 계산해 본 날짜만 제공한다. 최소·최적 기한이라고 주장하지 않는다.
      let possibleDeadlineDate: string | null = null;
      if (conditions.availableSecondsPerDay > 0) {
        let extension = Math.max(1, Math.ceil(result.shortageSeconds / conditions.availableSecondsPerDay));
        for (let attempt = 0; attempt < 8 && extension <= 3650; attempt++, extension *= 2) {
          try {
            let deadline = conditions.deadlineDate;
            for (let index = 0; index < extension; index++) deadline = nextPlanDate(deadline);
            if (scheduleLearningPlan(planInput(prepared.items, basis, { ...conditions, deadlineDate: deadline })).kind === "scheduled") { possibleDeadlineDate = deadline; break; }
          } catch (error) { if (!(error instanceof LearningPlanInputError)) throw error; break; }
        }
      }
      return { ...result, alternatives: [
        { kind: "increase-time", additionalCapacitySecondsLowerBound: result.shortageSeconds, sufficientByItself: false },
        ...(possibleDeadlineDate ? [{ kind: "extend-deadline", deadlineDate: possibleDeadlineDate, deadlineIsMinimum: false }] : []),
      ], proposal: null };
    }
    const candidate: LearningPlanCandidate = { items: prepared.items, assignments: result.assignments, normalizedDays: input.days,
      conditions: conditions as unknown as LearningPlanJsonObject, catalogSnapshot: basis.catalogSnapshot,
      excludedItems: prepared.normalized.excludedItems, progressSnapshot: snapshot(basis), carryoverCandidates: prepared.carryoverCandidates };
    const diff = calculateDiff(reference?.version?.candidate, candidate);
    const proposal = await repository.saveProposal({ studentId, expectedBasis: basis.basis, kind,
      scope: { fromDate: conditions.startDate, deadlineDate: conditions.deadlineDate, selectedCourseIds: basis.catalogSnapshot.map((s) => s.catalog.course.id) },
      reason: kind === "create" ? "실제 강의 전체의 날짜별 계획 생성" : "실제 잔여 진도·이월·변경 조건으로 전체 재편성", diff, candidate });
    return { kind: "proposed" as const, proposal, candidate, diff, warnings: result.warnings };
  }
  return {
    async create(input: CreateLearningPlanInput) {
      const basis = await repository.readBasis({ studentId: input.studentId, selections: input.selections });
      if (basis.plan) throw new LearningPlanRepositoryError("INVALID_STATE", "전체 계획이 이미 있습니다. 기존 계획 재편성을 사용하세요.");
      return propose(input.studentId, basis, { startDate: input.startDate ?? seoulToday(now()), deadlineDate: input.deadlineDate,
        availableSecondsPerDay: input.availableSecondsPerDay, dateOverrides: input.dateOverrides ?? [] }, "create");
    },
    async rebalance(input: RebalanceLearningPlanInput) {
      const reference = await current(input.studentId, input.planId);
      checkBasis(input.expectedBasis, reference.basis);
      const old = readConditions(reference.version!.candidate.conditions);
      const selections = input.selections ?? selectionsOf(reference.version!.candidate.catalogSnapshot);
      const basis = await repository.readBasis({ studentId: input.studentId, planId: input.planId, selections });
      // 새 선택 카탈로그 hash는 서버가 계산한다. 양 revision과 현재 버전은 기존 호출자 기준을 지킨다.
      checkBasis({ ...reference.basis, catalogHash: basis.basis.catalogHash }, basis.basis);
      const conditions: LearningPlanConditions = { ...old, startDate: input.fromDate ?? seoulToday(now()), deadlineDate: input.deadlineDate ?? old.deadlineDate,
        availableSecondsPerDay: input.availableSecondsPerDay ?? old.availableSecondsPerDay, dateOverrides: input.dateOverrides ?? old.dateOverrides };
      if (input.todayTime) {
        const today = seoulToday(now());
        const spent = basis.dailyUsage.find((entry) => entry.studyDate === today)?.spentSeconds ?? 0;
        const totalSeconds = input.todayTime.seconds + (input.todayTime.mode === "additional" ? spent : 0);
        conditions.dateOverrides = [...conditions.dateOverrides.filter((entry) => entry.date !== today), { date: today, totalSeconds }];
      }
      return propose(input.studentId, basis, conditions, "rebalance", reference);
    },
    async adjust(input: AdjustLearningPlanInput) {
      const basis = await current(input.studentId, input.planId);
      checkBasis(input.expectedBasis, basis.basis);
      const previous = basis.version!.candidate;
      const conditions = readConditions(previous.conditions);
      const prepared = candidateItems(basis, basis);
      const positions = new Map(basis.progress.map((p) => [p.itemKey, p.positionSeconds]));
      const scope = new Set(input.moves.map((move) => move.segmentKey));
      const outside = previous.assignments.filter((a) => !scope.has(a.segmentKey) && (positions.get(a.itemKey) ?? 0) > a.startOffsetSeconds);
      if (outside.length) return { kind: "conflict" as const, code: "ADJUSTMENT_CONFLICT", issues: [{ code: "EXECUTION_SCOPE_CONFLICT",
        message: "실제 진도 보정이 필요한 구간이 이동 범위 밖에 있습니다. 별도 전체 재편성을 요청하세요.", segmentKeys: outside.map((a) => a.segmentKey) }], proposal: null };
      const assignments = previous.assignments.filter((a) => a.endOffsetSeconds > (positions.get(a.itemKey) ?? 0)).map((a) => {
        const start = Math.max(a.startOffsetSeconds, positions.get(a.itemKey) ?? 0);
        return { ...a, startOffsetSeconds: start, durationSeconds: a.endOffsetSeconds - start };
      });
      const moved = new Set<string>();
      for (const move of input.moves) {
        if (moved.has(move.segmentKey)) throw new LearningPlanInputError("DUPLICATE_MOVE", "같은 예정 구간을 중복 이동할 수 없습니다.");
        moved.add(move.segmentKey);
        const assignment = assignments.find((a) => a.segmentKey === move.segmentKey);
        if (!assignment) throw new LearningPlanInputError("UNKNOWN_SEGMENT", "미완료 예정 구간을 지정하세요.");
        Object.assign(assignment, { date: move.date, order: move.order });
      }
      const scheduleInput = planInput(prepared.items, basis, conditions);
      const validation = validateLearningPlanSegments({ ...scheduleInput, assignments });
      if (validation.kind !== "valid") return { kind: "conflict" as const, code: "ADJUSTMENT_CONFLICT", issues: validation.issues, proposal: null };
      const candidate: LearningPlanCandidate = { ...previous, items: prepared.items, catalogSnapshot: basis.catalogSnapshot,
        assignments, normalizedDays: scheduleInput.days, progressSnapshot: snapshot(basis), carryoverCandidates: prepared.carryoverCandidates };
      const diff = calculateDiff(previous, candidate);
      const proposal = await repository.saveProposal({ studentId: input.studentId, expectedBasis: basis.basis, kind: "adjust",
        scope: { moves: input.moves }, reason: "명시한 예정 구간의 이동·교환", candidate, diff });
      return { kind: "proposed" as const, proposal, candidate, diff, warnings: [] };
    },
    confirm: repository.confirmProposal.bind(repository),
    recordProgress: repository.recordProgress.bind(repository),
    async feedback(input: { studentId: string; planId: string; itemKey: string; idempotencyKey: string; feedback: LearningPlanJsonObject }) {
      return repository.recordCompletion({ ...input, payload: input.feedback });
    },
    async read(input: { studentId: string; planId?: string; date?: string; versionId?: string }) {
      if (input.date && !validPlanDate(input.date)) throw new LearningPlanInputError("INVALID_DATE", "유효한 조회 날짜가 필요합니다.");
      const basis = await current(input.studentId, input.planId);
      const historical = input.versionId ? await repository.readPlan({ ...input, planId: basis.plan!.planId }) : undefined;
      if (input.versionId && !historical) throw new LearningPlanRepositoryError("NOT_FOUND", "버전이 없습니다.");
      if (historical) checkBasis({ ...basis.basis, catalogHash: basis.basis.catalogHash }, { ...basis.basis,
        currentVersionId: historical.plan.currentVersionId, planRevision: historical.plan.planRevision, completionRevision: historical.plan.completionRevision });
      const version = historical?.version ?? basis.version!;
      const assignments = version.candidate.assignments.filter((a) => !input.date || a.date === input.date)
        .sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
      return { plan: basis.plan, basis: basis.basis, version, assignments, completions: basis.completions,
        progress: basis.progress, dailyUsage: basis.dailyUsage, historicalItems: basis.historicalItems,
        days: version.candidate.normalizedDays.filter((day) => !input.date || day.date === input.date).map((day) => {
          const spentSeconds = basis.dailyUsage.find((entry) => entry.studyDate === day.date)?.spentSeconds ?? 0;
          return { date: day.date, totalSeconds: day.capacitySeconds, spentSeconds, remainingSeconds: Math.max(0, day.capacitySeconds - spentSeconds),
            scheduledSeconds: assignments.filter((a) => a.date === day.date).reduce((sum, a) => sum + a.durationSeconds, 0) };
        }) };
    },
  };
}

function readConditions(value: LearningPlanJsonObject): LearningPlanConditions {
  if (typeof value.startDate !== "string" || typeof value.deadlineDate !== "string" || typeof value.availableSecondsPerDay !== "number" || !Array.isArray(value.dateOverrides)) {
    throw new LearningPlanInputError("UNSUPPORTED_LEGACY_CONDITIONS", "이 버전은 새 날짜·총시간 조건 계약을 제공하지 않습니다.");
  }
  const conditions = value as unknown as LearningPlanConditions;
  normalizeLearningPlanDays(conditions);
  return structuredClone(conditions);
}
function calculateDiff(previous: LearningPlanCandidate | undefined, candidate: LearningPlanCandidate): LearningPlanJsonObject {
  const before = new Map((previous?.assignments ?? []).map((a) => [a.segmentKey, a]));
  const after = new Map(candidate.assignments.map((a) => [a.segmentKey, a]));
  const changed = new Set([...before.keys(), ...after.keys()].filter((key) => JSON.stringify(before.get(key)) !== JSON.stringify(after.get(key))));
  return { changedSegmentKeys: [...changed], affectedDates: [...new Set([...before, ...after].filter(([key]) => changed.has(key)).map(([, a]) => a.date))].sort(),
    addedCourseIds: candidate.catalogSnapshot.filter((s) => !previous?.catalogSnapshot.some((old) => old.catalog.course.id === s.catalog.course.id)).map((s) => s.catalog.course.id),
    removedCourseIds: (previous?.catalogSnapshot ?? []).filter((s) => !candidate.catalogSnapshot.some((next) => next.catalog.course.id === s.catalog.course.id)).map((s) => s.catalog.course.id),
    deadlineDate: candidate.conditions.deadlineDate ?? null, conditionsChanged: JSON.stringify(previous?.conditions) !== JSON.stringify(candidate.conditions),
    noChange: changed.size === 0 && JSON.stringify(previous?.conditions) === JSON.stringify(candidate.conditions) };
}
