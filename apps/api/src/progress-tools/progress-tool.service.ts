import type { ProgressService } from "../progress/progress.types.js";
import type { ProgressToolService } from "./progress-tool.types.js";

export function createProgressToolService(progressService: ProgressService): ProgressToolService {
  return {
    async execute({ tool, input }) {
      const studentId = input.studentId?.trim() || "000";

      switch (tool) {
        case "adjust_today_session": {
          const result = await progressService.createAdjustmentProposal(studentId, input.message ?? "");
          return result ? { kind: "success", result } : { kind: "not-found" };
        }
        case "insert_remediation": {
          const result = await progressService.insertRemediation(studentId, input);
          return result ? { kind: "success", result } : { kind: "not-found" };
        }
        case "defer_learning_item": {
          const result = await progressService.deferLessonItem(studentId, input.lessonItemId);
          return result ? { kind: "success", result } : { kind: "not-found" };
        }
        case "assess_schedule_impact":
          return {
            kind: "success",
            result: await progressService.assessScheduleImpact(studentId, input),
          };
      }
    },
  };
}
