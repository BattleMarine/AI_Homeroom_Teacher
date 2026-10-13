import { seoulToday } from "../learning-plan/learning-plan.calendar.js";
import type { CourseCatalogLesson } from "../course-catalog/course-catalog.types.js";
import type { createLearningPlanService } from "../learning-plan/learning-plan.service.js";

export type ChatCurrentPlan = Awaited<ReturnType<ReturnType<typeof createLearningPlanService>["read"]>>;

/** 같은 조회 snapshot의 예정·실제를 표시용으로 결합한다. 배치·진도·시간 원본은 수정하지 않는다. */
export function buildLearningPlanView(plan: ChatCurrentPlan, now: Date = new Date()) {
  const courses = new Map(plan.version.candidate.catalogSnapshot.map(({ catalog }) => [catalog.course.id, catalog.course]));
  const lessons = new Map(plan.version.candidate.catalogSnapshot.map(({ catalog }) => [catalog.course.id,
    new Map<string, CourseCatalogLesson>(catalog.lessons.map((lesson) => [lesson.id, lesson]))]));
  const progress = new Map(plan.progress.map((entry) => [entry.itemKey, entry]));
  const completions = new Map(plan.completions.map((entry) => [entry.itemKey, entry]));
  const items = plan.version.candidate.items.map((item) => {
    const course = courses.get(item.courseId);
    const lesson = lessons.get(item.courseId)?.get(item.lessonId);
    const completion = completions.get(item.itemKey);
    const actual = progress.get(item.itemKey);
    const positionSeconds = actual?.positionSeconds ?? 0;
    return { ...item, lessonTitle: lesson?.title ?? null, courseTitle: course?.title ?? null, lectureNumber: lesson?.lectureNumber ?? null,
      metadataMissing: !course || !lesson, carryoverSinceDate: actual?.carryoverSinceDate ?? item.carryoverSinceDate ?? null,
      positionSeconds, remainingSeconds: Math.max(0, item.durationSeconds - positionSeconds),
      completed: !!completion, completedAt: completion?.completedAt ?? null, feedbackSubmitted: completion?.payload != null,
      feedback: completion?.payload ?? null, feedbackSubmittedAt: completion?.feedbackSubmittedAt ?? null };
  });
  const byKey = new Map(items.map((item) => [item.itemKey, item]));
  const assignments = plan.assignments.map((assignment) => {
    const item = byKey.get(assignment.itemKey);
    const remainingSeconds = Math.max(0, assignment.endOffsetSeconds - Math.max(assignment.startOffsetSeconds, item?.positionSeconds ?? 0));
    return { ...assignment, lessonTitle: item?.lessonTitle ?? null, courseTitle: item?.courseTitle ?? null,
      lectureNumber: item?.lectureNumber ?? null, remainingSeconds, completed: remainingSeconds === 0 };
  });
  const remainingByDate = new Map<string, number>();
  for (const assignment of assignments) remainingByDate.set(assignment.date, (remainingByDate.get(assignment.date) ?? 0) + assignment.remainingSeconds);
  const days = plan.days.map((day) => ({ ...day, remainingScheduledSeconds: remainingByDate.get(day.date) ?? 0 }));
  const todayDate = seoulToday(now);
  const today = days.find((day) => day.date === todayDate);
  return { todayDate, items, assignments, days,
    today: { ...(today ?? { date: todayDate, totalSeconds: 0, spentSeconds: plan.dailyUsage.find((usage) => usage.studyDate === todayDate)?.spentSeconds ?? 0,
      remainingSeconds: 0, scheduledSeconds: 0, remainingScheduledSeconds: 0 }), inPlanPeriod: !!today,
      assignments: assignments.filter((assignment) => assignment.date === todayDate) } };
}
export type LearningPlanView = ReturnType<typeof buildLearningPlanView>;
