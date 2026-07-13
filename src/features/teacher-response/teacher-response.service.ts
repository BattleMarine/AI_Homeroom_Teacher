import {
  createMockAdjustmentReason,
  createMockNextSessionExplanationItems,
  createMockNextSessionAdjustmentReason,
  createMockNextSessionTeacherComment,
  createMockTeacherComment,
  createMockTodaySessionExplanationItems,
} from "./teacher-response.mock";
import type {
  NextSessionResponseContext,
  TeacherResponseResult,
  TodaySessionResponseContext,
} from "./teacher-response.types";

export function createTodaySessionResponse(
  context: TodaySessionResponseContext,
): TeacherResponseResult {
  return {
    adjustmentReason: createMockAdjustmentReason(context),
    explanationItems: createMockTodaySessionExplanationItems(context),
    teacherComment: createMockTeacherComment(context),
  };
}

export function createNextSessionResponse(
  context: NextSessionResponseContext,
): TeacherResponseResult {
  return {
    adjustmentReason: createMockNextSessionAdjustmentReason(context),
    explanationItems: createMockNextSessionExplanationItems(context),
    teacherComment: createMockNextSessionTeacherComment(context),
  };
}
