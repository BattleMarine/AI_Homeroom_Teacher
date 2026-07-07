import type { CurriculumId } from "../curriculum";
import type { LearningCheckAnalysis } from "../learning-check";
import type { LessonItem, TodaySession } from "../../types/shared.types";

export type OrchestrationReasonCode =
  | "current_step_based"
  | "weak_concept_review"
  | "session_time_limit"
  | "ready_for_next_step";

export type NextSessionReasonCode =
  | "learning_check_based"
  | "review_inserted"
  | "progress_delayed"
  | "next_step_selected"
  | "next_session_load_reduced"
  | "session_time_limit"
  | "curriculum_completed";

export type StudentProgressState = {
  selectedCurriculumId: CurriculumId;
  currentStepId: string;
  weakConcepts: string[];
  completedStepIds: string[];
  delayedStepIds: string[];
};

export type GenerateTodaySessionInput = {
  studentState: StudentProgressState;
  maxMinutes?: number;
  date?: string;
};

export type GeneratedTodaySession = TodaySession & {
  date: string;
  reasonCodes: OrchestrationReasonCode[];
  delayedItems: LessonItem[];
};

export type GenerateNextSessionInput = {
  studentState: StudentProgressState;
  todaySession: GeneratedTodaySession;
  learningAnalysis: LearningCheckAnalysis;
  previousDelayedItems?: LessonItem[];
  maxMinutes?: number;
  date?: string;
};

export type GeneratedNextSession = TodaySession & {
  date: string;
  targetStepId: string;
  targetStepTitle: string;
  reviewConcepts: string[];
  carryOverItems: LessonItem[];
  delayedItems: LessonItem[];
  reasonCodes: NextSessionReasonCode[];
};
