import type { PersistedAdjustmentProposal, PersistedProgressState } from "./progress.types.js";

export type LessonFeedbackEventInput = {
  lessonItemId: string;
  understandingLevel: number;
  focusLevel: number;
  reasonCodes: string[];
};

export type ProgressStateMutation<T> = {
  state: PersistedProgressState;
  result: T;
  feedbackEvent?: LessonFeedbackEventInput;
};

export type ProposalConfirmation<T> =
  | { kind: "not-found" }
  | { kind: "revision-conflict"; currentRevision: number; expectedRevision: number }
  | { kind: "confirmed"; result: T };

export type ProgressStateRepository = {
  getOrCreate(studentId: string, initialState: PersistedProgressState): Promise<PersistedProgressState>;
  mutate<T>(
    studentId: string,
    initialState: PersistedProgressState,
    callback: (state: PersistedProgressState) => ProgressStateMutation<T>,
  ): Promise<T>;
  createProposal(proposal: PersistedAdjustmentProposal): Promise<void>;
  selectCurriculum?<T>(
    studentId: string,
    curriculumId: string,
    initialState: PersistedProgressState,
    callback: (state: PersistedProgressState) => ProgressStateMutation<T>,
  ): Promise<T | undefined>;
  confirmProposal<T>(
    studentId: string,
    adjustmentId: string,
    expectedRevision: number | undefined,
    initialState: PersistedProgressState,
    callback: (state: PersistedProgressState, proposal: PersistedAdjustmentProposal) => ProgressStateMutation<T>,
  ): Promise<ProposalConfirmation<T>>;
};
