import type { LearningPlanAssignment, LearningPlanCatalogItem, LearningPlanCatalogSelection,
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
export type LearningPlanStoredItem = LearningPlanCatalogItem & { itemKey: string };
export type LearningPlanStoredAssignment = LearningPlanAssignment & { itemKey: string };
/** 도메인 계산/정책 검증이 끝난 후보. 저장층에서 미결 조건을 채우지 않는다. */
export type LearningPlanCandidate = {
  items: LearningPlanStoredItem[];
  assignments: LearningPlanStoredAssignment[];
  normalizedDays: LearningPlanDayCapacity[];
  conditions: LearningPlanJsonObject;
  catalogSnapshot: LearningPlanCatalogSelection[];
  excludedItems: LearningPlanExcludedItem[];
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
};
export type LearningPlanCompletion = {
  planId: string; itemKey: string; payload: LearningPlanJsonObject;
  completedAt: string; completionRevision: number;
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
};
export type LearningPlanReadBasisResult = {
  plan: LearningPlanHeader | null; version: LearningPlanVersion | null;
  completions: LearningPlanCompletion[]; catalogSnapshot: LearningPlanCatalogSelection[];
  basis: LearningPlanBasis;
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
  /** 키는 planId 내에서 고유하다. 새 alias도 최초 완료에 귀속해 다른 대상 재사용을 막는다. */
  recordCompletion(input: { studentId: string; planId: string; itemKey: string; idempotencyKey: string;
    payload: LearningPlanJsonObject }): Promise<{ completion: LearningPlanCompletion; replayed: boolean }>;
  readPlan(input: { studentId: string; planId?: string; versionId?: string; date?: string }): Promise<LearningPlanReadResult | undefined>;
};
