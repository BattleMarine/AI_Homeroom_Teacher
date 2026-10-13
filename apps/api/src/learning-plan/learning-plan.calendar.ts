import type { LearningPlanDayCapacity } from "./learning-plan.types.js";

export class LearningPlanInputError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}
export type LearningPlanConditions = {
  startDate: string;
  deadlineDate: string;
  availableSecondsPerDay: number;
  dateOverrides: Array<{ date: string; totalSeconds: number }>;
};

export function seoulToday(now = new Date()): string {
  // 한국 시간에는 일광 절약 시간이 없다. 호스트의 시간대는 사용하지 않는다.
  return new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}
export function validPlanDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number(date.slice(0, 4)) >= 1 && Number.isFinite(Date.parse(`${date}T00:00:00Z`)) &&
    new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
}
export function nextPlanDate(date: string): string {
  const result = new Date(Date.parse(`${date}T00:00:00Z`) + 86400_000).toISOString().slice(0, 10);
  if (!validPlanDate(result)) throw new LearningPlanInputError("UNSUPPORTED_DATE_RANGE", "지원 가능한 날짜 범위를 넘습니다.");
  return result;
}
export function normalizeLearningPlanDays(conditions: LearningPlanConditions,
  usage: readonly { studyDate: string; spentSeconds: number }[] = []): LearningPlanDayCapacity[] {
  if (!validPlanDate(conditions.startDate) || !validPlanDate(conditions.deadlineDate) || conditions.startDate > conditions.deadlineDate) {
    throw new LearningPlanInputError("INVALID_DATE_RANGE", "시작일·마감일은 유효한 날짜이며 시작일이 앞서야 합니다.");
  }
  if (!validSeconds(conditions.availableSecondsPerDay)) throw new LearningPlanInputError("INVALID_TIME", "하루 총한도는 0~86400 정수 초여야 합니다.");
  const overrides = new Map<string, number>();
  for (const override of conditions.dateOverrides) {
    if (!validPlanDate(override.date) || !validSeconds(override.totalSeconds) || overrides.has(override.date)) {
      throw new LearningPlanInputError("INVALID_DATE_OVERRIDE", "날짜 예외는 유효한 날짜·총한도이며 중복될 수 없습니다.");
    }
    overrides.set(override.date, override.totalSeconds);
  }
  const used = new Map<string, number>();
  for (const entry of usage) {
    if (!validPlanDate(entry.studyDate) || !Number.isSafeInteger(entry.spentSeconds) || entry.spentSeconds < 0 || used.has(entry.studyDate)) {
      throw new LearningPlanInputError("INVALID_EXECUTION_USAGE", "저장된 일별 소비 시간의 형식이 유효하지 않습니다.");
    }
    used.set(entry.studyDate, entry.spentSeconds);
  }
  const days: LearningPlanDayCapacity[] = [];
  for (let date = conditions.startDate; date <= conditions.deadlineDate; date = nextPlanDate(date)) {
    if (days.length >= 3650) throw new LearningPlanInputError("UNSUPPORTED_DATE_RANGE", "현재 지원 기간은 최대 3650일입니다.");
    // 저장 한도는 총한도다. 실제 소비 차감은 엔진·검증기가 별도로 수행한다.
    days.push({ date, capacitySeconds: overrides.get(date) ?? conditions.availableSecondsPerDay });
    if (date === conditions.deadlineDate) break;
  }
  return days;
}
function validSeconds(value: number) { return Number.isSafeInteger(value) && value >= 0 && value <= 86400; }
