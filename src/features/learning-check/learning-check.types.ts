import type { TodaySession } from "../../types/shared.types";

export type LearningCheckLevel = 1 | 2 | 3 | 4 | 5;

export type ProblemResult = {
  correctCount: number;
  totalCount: number;
};

export type LearningCheckSubmission = {
  sessionDate: string;
  completedItemIds: string[];
  skippedItemIds: string[];
  understandingLevel: LearningCheckLevel;
  focusLevel: LearningCheckLevel;
  confusedConcepts: string[];
  problemResult: ProblemResult;
};

export type LearningCheckReasonCode =
  | "low_understanding"
  | "low_focus"
  | "confused_concepts"
  | "low_problem_accuracy"
  | "incomplete_required_items"
  | "stable_progress";

export type LearningRecommendation =
  | "insert_review"
  | "delay_progress"
  | "reduce_next_session_load"
  | "keep_pace";

export type LearningCheckAnalysisInput = {
  submission: LearningCheckSubmission;
  todaySession: TodaySession;
};

export type LearningCheckAnalysis = {
  reviewRequired: boolean;
  progressDelayRequired: boolean;
  reduceNextSessionLoad: boolean;
  reviewConcepts: string[];
  carryOverItemIds: string[];
  problemAccuracy: number | null;
  reasonCodes: LearningCheckReasonCode[];
  recommendedActions: LearningRecommendation[];
};
