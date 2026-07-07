import type { CurriculumStep } from "../curriculum";
import type {
  NextSessionReasonCode,
  OrchestrationReasonCode,
} from "../progress-orchestrator/progress.types";
import type { LessonItem } from "../../types/shared.types";

export type TodaySessionResponseContext = {
  currentStep: CurriculumStep;
  relatedWeakConcepts: string[];
  delayedItems: LessonItem[];
  maxMinutes: number;
  reasonCodes: OrchestrationReasonCode[];
};

export type TeacherResponseResult = {
  adjustmentReason: string;
  teacherComment: string;
};

export type NextSessionResponseContext = {
  targetStep: CurriculumStep;
  reviewConcepts: string[];
  carryOverItems: LessonItem[];
  delayedItems: LessonItem[];
  maxMinutes: number;
  reasonCodes: NextSessionReasonCode[];
};
