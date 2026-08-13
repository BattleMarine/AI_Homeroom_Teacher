import type { CurriculumRecommendation, CurriculumRecommendationService } from "../curriculum-recommendation/curriculum-recommendation.types.js";
import type { CurriculumDefinition, ProgressService } from "../progress/progress.types.js";
import type {
  CurriculumPlanProfile,
  CurriculumToolRequest,
  CurriculumToolResult,
  CurriculumToolService,
} from "./curriculum-tool.types.js";

const defaultStudentId = "000";

export function createCurriculumToolService(
  curriculumRecommendationService: CurriculumRecommendationService,
  progressService?: ProgressService,
): CurriculumToolService {
  const appliedPlans = new Map<string, CurriculumToolResult>();

  return {
    async execute(request) {
      const recommendationResult = await curriculumRecommendationService.recommend(request.input);

      if (recommendationResult.kind !== "success") return recommendationResult;

      const studentId = request.input.studentId?.trim() || defaultStudentId;
      const requestedPlanProfile = request.input.planProfile ?? "stable";
      const applied = request.tool === "apply_curriculum_plan";
      const planId = applied ? `curriculum-plan:${studentId}` : null;
      const recommendation = recommendationResult.recommendation;
      const result: CurriculumToolResult = {
        tool: request.tool,
        requestedPlanProfile,
        appliedPlanProfile: "baseline",
        planId,
        applied,
        recommendation,
        deadline: {
          targetDays: recommendation.summary.targetDays,
          targetAchievable: recommendation.feasibility.targetAchievable,
          minimumRequiredDays: recommendation.summary.minimumRequiredDays,
          requiredAverageMinutesPerDay: recommendation.feasibility.requiredAverageMinutesPerDay,
        },
        reasonCodes: [
          "curriculum_tool_executed",
          "baseline_plan_shared_across_profiles",
          ...getToolReasonCodes(request.tool, requestedPlanProfile),
        ],
        teacherSummary: createTeacherSummary(request.tool, requestedPlanProfile, recommendation.teacherSummary),
      };

      if (applied) {
        appliedPlans.set(studentId, result);
        await progressService?.applyCurriculumPlan(studentId, createProgressCurriculum(recommendation));
      }

      return { kind: "success", result };
    },

    async getAppliedPlan(studentId) {
      return appliedPlans.get(studentId.trim() || defaultStudentId);
    },
  };
}

function getToolReasonCodes(
  tool: CurriculumToolRequest["tool"],
  requestedPlanProfile: CurriculumPlanProfile,
): string[] {
  const profileReason = `requested_${requestedPlanProfile}_profile`;

  switch (tool) {
    case "create_curriculum_plan":
      return [profileReason, "initial_plan_generated"];
    case "compress_curriculum_plan":
      return [profileReason, "compression_policy_reserved"];
    case "extend_curriculum_plan":
      return [profileReason, "extension_policy_reserved"];
    case "assess_curriculum_deadline":
      return [profileReason, "deadline_assessed"];
    case "apply_curriculum_plan":
      return [profileReason, "plan_applied_to_mock_state"];
  }
}

function createTeacherSummary(
  tool: CurriculumToolRequest["tool"],
  requestedPlanProfile: CurriculumPlanProfile,
  recommendationSummary: string,
): string {
  const baselineNotice = `현재 ${requestedPlanProfile} 선택은 기준 계획과 같은 강의 순서와 학습량을 사용합니다.`;

  switch (tool) {
    case "create_curriculum_plan":
      return `${baselineNotice} ${recommendationSummary}`;
    case "compress_curriculum_plan":
      return `${baselineNotice} 압축 규칙은 다음 단계에서 별도로 적용합니다. ${recommendationSummary}`;
    case "extend_curriculum_plan":
      return `${baselineNotice} 연장 규칙은 다음 단계에서 별도로 적용합니다. ${recommendationSummary}`;
    case "assess_curriculum_deadline":
      return `${baselineNotice} 현재 기한 가능 여부를 계산했습니다. ${recommendationSummary}`;
    case "apply_curriculum_plan":
      return `${baselineNotice} 확인한 기준 계획을 mock 상태에 적용했습니다.`;
  }
}

function createProgressCurriculum(recommendation: CurriculumRecommendation): CurriculumDefinition {
  const steps = recommendation.sessions.map((session) => ({
    id: `planned-day-${session.dayIndex}`,
    title: `${session.dayIndex}일차 학습`,
    goal: session.lessons.map((lesson) => lesson.title).join(" · "),
    conceptTags: [...new Set(session.lessons.flatMap((lesson) => lesson.unitNames))],
    estimatedMinutes: session.estimatedMinutes,
    items: session.lessons.map((lesson) => ({
      id: lesson.id,
      kind: (lesson.lessonType === "lecture" ? "lecture" : "practice") as "lecture" | "practice",
      title: lesson.title,
      description: `${lesson.title} 학습 항목입니다.`,
      conceptTags: lesson.unitNames,
      estimatedMinutes: lesson.estimatedMinutes,
      required: true,
      reason: "적용된 커리큘럼 계획",
      playbackTargetId: lesson.lessonType === "lecture" ? `mock-video:${lesson.id}` : undefined,
      mockPlayback: lesson.lessonType === "lecture" ? {
        kind: "mock-video" as "mock-video",
        targetId: `mock-video:${lesson.id}`,
        mediaType: "image" as "image",
        contentType: "image/png" as "image/png",
        assetKey: "mock-logarithm-lecture" as "mock-logarithm-lecture",
        durationSeconds: lesson.estimatedMinutes * 60,
      } : undefined,
    })),
  }));

  return {
    id: "stable-log",
    title: `적용된 ${recommendation.course.title} 계획`,
    pace: "stable" as CurriculumDefinition["pace"],
    description: "카탈로그 기반 규칙 엔진이 생성해 적용한 계획입니다.",
    recommendedFor: [],
    teacherComment: recommendation.teacherSummary,
    initialProgress: {
      currentStepId: steps[0]?.id ?? "planned-day-1",
      completedStepIds: [],
      weakConcepts: [...recommendation.scope.weakUnitNames],
    },
    steps,
  };
}
