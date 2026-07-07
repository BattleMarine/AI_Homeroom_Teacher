import type { CurriculumStep } from "../curriculum";
import type { OrchestrationReasonCode } from "../progress-orchestrator/progress.types";
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
