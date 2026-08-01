export const progressToolNames = [
  "insert_remediation",
  "defer_learning_item",
  "assess_schedule_impact",
] as const;

export type ProgressToolName = (typeof progressToolNames)[number];

export type ProgressToolInput = {
  studentId?: string;
  concept?: string;
  lessonItemId?: string;
  estimatedMinutes?: number;
  availableMinutesPerDay?: number;
  targetDays?: number;
};

export type ProgressToolService = {
  execute(request: { tool: ProgressToolName; input: ProgressToolInput }):
    | { kind: "success"; result: Record<string, unknown> }
    | { kind: "not-found" };
};
