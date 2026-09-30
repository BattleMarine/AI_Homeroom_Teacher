import type { LearningPlanSegmentAssignment, LearningPlanCatalogItem, LearningPlanCatalogSelection,
  LearningPlanDayCapacity, LearningPlanExcludedItem } from "./learning-plan.types.js";

export const learningPlanProposalTtlSeconds = 30 * 60;
export type LearningPlanJson = null | boolean | number | string | LearningPlanJson[] | { [key: string]: LearningPlanJson };
export type LearningPlanJsonObject = { [key: string]: LearningPlanJson };
export type LearningPlanSelection = { subjectCode: string; courseId: string };
export type LearningPlanBasis = {
  planId: string | null;
  currentVersionId: string | null;
  planRevision: number;
  completionRevision: number;
  /** 조회 요청/후보가 선택한 카탈로그 전체의 hash. 현재 version의 hash와 다를 수 있다. */
  catalogHash: string;
};
export type LearningPlanStoredItem = LearningPlanCatalogItem & { itemKey: string; carryoverSinceDate?: string | null };
export type LearningPlanStoredAssignment = LearningPlanSegmentAssignment;
export type LearningPlanProgress = { planId: string; itemKey: string; positionSeconds: number; carryoverSinceDate: string | null };
export type LearningPlanDailyUsage = { studyDate: string; spentSeconds: number };
export type LearningPlanProgressSnapshot = {
  progress: Array<{ itemKey: string; positionSeconds: number }>;
  dailyUsage: LearningPlanDailyUsage[];
};
/** 도메인 계산/정책 검증이 끝난 후보. 저장층에서 미결 조건을 채우지 않는다. */
export type LearningPlanCandidate = {
  items: LearningPlanStoredItem[];
  assignments: LearningPlanStoredAssignment[];
  normalizedDays: LearningPlanDayCapacity[];
  conditions: LearningPlanJsonObject;
  catalogSnapshot: LearningPlanCatalogSelection[];
  excludedItems: LearningPlanExcludedItem[];
  /** 신규 후보 필수. 과거 0007 조회의 미기록값만 null로 표시한다. */
  progressSnapshot: LearningPlanProgressSnapshot | null;
  carryoverCandidates: Array<{ itemKey: string; carryoverSinceDate: string }>;
};
export type LearningPlanChangeKind = "create" | "adjust" | "rebalance";
export type LearningPlanHeader = {
  planId: string; studentId: string; currentVersionId: string;
  planRevision: number; completionRevision: number;
};
export type LearningPlanVersion = {
  versionId: string; planId: string; versionNumber: number; kind: LearningPlanChangeKind;
  scope: LearningPlanJsonObject; reason: string; diff: LearningPlanJsonObject;
  candidate: LearningPlanCandidate; catalogHash: string; createdAt: string;
  /** 원본 JSON은 보존한 채 과거 whole 배치를 구간 view로 복원했는지 표시한다. */
  legacyNormalized?: boolean;
};
export type LearningPlanCompletion = {
  /** payload null은 미제출이며 {}는 제출된 feedback이다. */
  planId: string; itemKey: string; payload: LearningPlanJsonObject | null;
  completedAt: string; completionRevision: number;
  feedbackSubmittedAt: string | null; feedbackRevision: number | null;
};
export type LearningPlanProgressEvent = {
  eventId: string; planId: string; itemKey: string; idempotencyKey: string;
  positionSeconds: number; spentSeconds: number; studyDate: string; createdAt: string; executionRevision: number;
};
export type LearningPlanRecordProgressInput = {
  studentId: string; planId: string; itemKey: string; idempotencyKey: string;
  positionSeconds: number; spentSeconds: number; feedback?: LearningPlanJsonObject;
};
export type LearningPlanRecordProgressResult = {
  event: LearningPlanProgressEvent; progress: LearningPlanProgress;
  completion: LearningPlanCompletion | null; completionRevision: number; replayed: boolean;
};
export type LearningPlanProposal = {
  proposalId: string; studentId: string; targetPlanId: string;
  expectedBasis: LearningPlanBasis; createdAt: string; expiresAt: string;
};
export type LearningPlanConfirmResult = {
  planId: string; version: LearningPlanVersion; basis: LearningPlanBasis; replayed: boolean;
};
export type LearningPlanReadResult = {
  plan: LearningPlanHeader;
  /** 과거 version 조회에서도 예정 일정/조건은 당시 snapshot이다. */
  version: LearningPlanVersion;
  assignments: LearningPlanStoredAssignment[];
  /** 현재 실제 기록을 별도 반환한다. 과거 version의 lessonId에 합치지 않는다. */
  completions: LearningPlanCompletion[];
  progress: LearningPlanProgress[]; dailyUsage: LearningPlanDailyUsage[]; historicalItems: LearningPlanStoredItem[];
};
export type LearningPlanReadBasisResult = {
  plan: LearningPlanHeader | null; version: LearningPlanVersion | null;
  completions: LearningPlanCompletion[]; catalogSnapshot: LearningPlanCatalogSelection[];
  basis: LearningPlanBasis;
  progress: LearningPlanProgress[]; dailyUsage: LearningPlanDailyUsage[]; historicalItems: LearningPlanStoredItem[];
};
export type LearningPlanSaveProposalInput = {
  studentId: string; expectedBasis: LearningPlanBasis; kind: LearningPlanChangeKind;
  scope: LearningPlanJsonObject; reason: string; diff: LearningPlanJsonObject;
  candidate: LearningPlanCandidate;
};
export type LearningPlanRepositoryErrorCode = "NOT_FOUND" | "BASIS_CONFLICT" | "CATALOG_CONFLICT"
  | "PROPOSAL_EXPIRED" | "INVALID_STATE" | "INVALID_CANDIDATE" | "IDEMPOTENCY_CONFLICT";
export class LearningPlanRepositoryError extends Error {
  constructor(public readonly code: LearningPlanRepositoryErrorCode, message: string) {
    super(message);
    this.name = "LearningPlanRepositoryError";
  }
}
export type LearningPlanRepository = {
  readBasis(input: { studentId: string; planId?: string; selections: LearningPlanSelection[] }): Promise<LearningPlanReadBasisResult>;
  saveProposal(input: LearningPlanSaveProposalInput): Promise<LearningPlanProposal>;
  confirmProposal(input: { studentId: string; proposalId: string; expectedBasis: LearningPlanBasis }): Promise<LearningPlanConfirmResult>;
  /** 실제 event key는 (planId,progress) 범위. feedback key와 별개다. 날짜는 DB 서울 시각으로 부여한다. */
  recordProgress(input: LearningPlanRecordProgressInput): Promise<LearningPlanRecordProgressResult>;
  /** 실제 종료 후 첫 feedback만 제출한다. 키는 (planId,feedback) 범위이며 progress key와 별개다. */
  recordCompletion(input: { studentId: string; planId: string; itemKey: string; idempotencyKey: string;
    payload: LearningPlanJsonObject }): Promise<{ completion: LearningPlanCompletion; replayed: boolean }>;
  readPlan(input: { studentId: string; planId?: string; versionId?: string; date?: string }): Promise<LearningPlanReadResult | undefined>;
};
