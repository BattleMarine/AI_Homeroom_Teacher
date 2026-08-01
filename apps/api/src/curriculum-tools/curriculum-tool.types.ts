import type {
  CurriculumRecommendation,
  CurriculumRecommendationInput,
} from "../curriculum-recommendation/curriculum-recommendation.types.js";

export const curriculumToolNames = [
  "create_curriculum_plan",
  "compress_curriculum_plan",
  "extend_curriculum_plan",
  "assess_curriculum_deadline",
  "apply_curriculum_plan",
] as const;

export type CurriculumToolName = (typeof curriculumToolNames)[number];
export type CurriculumPlanProfile = "stable" | "compressed" | "practice";

export type CurriculumToolInput = CurriculumRecommendationInput & {
  studentId?: string;
  planProfile?: CurriculumPlanProfile;
};

export type CurriculumToolRequest = {
  tool: CurriculumToolName;
  input: CurriculumToolInput;
};

export type CurriculumToolResult = {
  tool: CurriculumToolName;
  requestedPlanProfile: CurriculumPlanProfile;
  appliedPlanProfile: "baseline";
  planId: string | null;
  applied: boolean;
  recommendation: CurriculumRecommendation;
  deadline: {
    targetDays: number | null;
    targetAchievable: boolean | null;
    minimumRequiredDays: number;
    requiredAverageMinutesPerDay: number | null;
  };
  reasonCodes: string[];
  teacherSummary: string;
};

export type CurriculumToolService = {
  execute(request: CurriculumToolRequest):
    | { kind: "success"; result: CurriculumToolResult }
    | { kind: "course-not-found" }
    | { kind: "no-matching-lessons" };
  getAppliedPlan(studentId: string): CurriculumToolResult | undefined;
};
