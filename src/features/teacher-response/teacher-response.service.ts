import {
  createMockAdjustmentReason,
  createMockNextSessionAdjustmentReason,
  createMockNextSessionTeacherComment,
  createMockTeacherComment,
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
    teacherComment: createMockTeacherComment(context),
  };
}

export function createNextSessionResponse(
  context: NextSessionResponseContext,
): TeacherResponseResult {
  return {
    adjustmentReason: createMockNextSessionAdjustmentReason(context),
    teacherComment: createMockNextSessionTeacherComment(context),
  };
}
