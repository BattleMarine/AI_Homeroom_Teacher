import type { StudentProgressState } from "./progress.types";

export type StudentRequestKind =
  | "default"
  | "short_time"
  | "review_first"
  | "confused_concept"
  | "reduce_new_lecture";

export type StudentRequestAdjustmentInput<
  TStudentState extends StudentProgressState = StudentProgressState,
> = {
  studentState: TStudentState;
  requestKind: StudentRequestKind;
  focusConcept?: string;
  currentStepConcepts?: string[];
};

export type StudentRequestAdjustment<
  TStudentState extends StudentProgressState = StudentProgressState,
> = {
  adjustedStudentState: TStudentState;
  maxMinutes?: number;
  summary: string;
  teacherNote: string;
};
