import type { CurriculumId } from "../curriculum";
import type { LessonItem, TodaySession } from "../../types/shared.types";

export type OrchestrationReasonCode =
  | "current_step_based"
  | "weak_concept_review"
  | "session_time_limit"
  | "ready_for_next_step";

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
