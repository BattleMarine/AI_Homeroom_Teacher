import {
  createMockAdjustmentReason,
  createMockTeacherComment,
} from "./teacher-response.mock";
import type {
  TeacherResponseResult,
  TodaySessionResponseContext,
} from "./teacher-response.types";

export function createTodaySessionResponse(
  context: TodaySessionResponseContext,
): TeacherResponseResult {
  return {
    adjustmentReason: createMockAdjustmentReason(context),
    teacherComment: createMockTeacherComment(context),
  };
}
