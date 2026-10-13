import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createFileCourseCatalogRepository } from "../src/course-catalog/course-catalog.file-repository.js";
import { scheduleLearningPlan } from "../src/learning-plan/learning-plan.scheduler.js";
import { normalizeLearningPlanDays } from "../src/learning-plan/learning-plan.calendar.js";
import { checkLearningPlanIndependently } from "../test/helpers/learning-plan-independent-check.js";
import { assertLearningPlanDistribution, measureLearningPlanDistribution } from "../test/helpers/learning-plan-distribution-check.js";
import type { LearningPlanSegmentValidationInput } from "../src/learning-plan/learning-plan.types.js";

// baseline에는 공개 카탈로그 일정/품질만 저장한다. 환경·학생·실제 계획을 읽거나 모델을 호출하지 않는다.
const catalog = createFileCourseCatalogRepository();
const courses = await catalog.listCourses();
const items = (await Promise.all(courses.map(async course => (await catalog.getCourseCatalog(course.id))!.lessons
  .filter(lesson => lesson.lessonType === "lecture" || lesson.lessonType === "mock_exam")
  .map(lesson => ({ itemKey: lesson.id, lessonId: lesson.id, subjectCode: course.primarySubject, courseId: course.id,
    sequence: lesson.sequence, durationSeconds: lesson.duration.seconds, lessonType: lesson.lessonType as "lecture" | "mock_exam" }))))).flat();
assert.equal(items.length, 126); assert.equal(items.reduce((sum, item) => sum + item.durationSeconds, 0), 419939);
const startDate = "2026-10-01";
const weekendOverrides = Array.from({ length: 43 }, (_, n) => addDays(startDate, n)).filter(date => [0, 6].includes(new Date(date + "T00:00:00Z").getUTCDay())).map(date => ({ date, totalSeconds: 9000 }));
const cases = [
  { name: "43일240분", deadlineDate: "2026-11-12", dateOverrides: [] },
  { name: "오늘180분", deadlineDate: "2026-11-12", dateOverrides: [{ date: startDate, totalSeconds: 10800 }] },
  { name: "주말날짜150분", deadlineDate: "2026-11-12", dateOverrides: [{ date: startDate, totalSeconds: 10800 }, ...weekendOverrides] },
  { name: "기한연장73일", deadlineDate: "2026-12-12", dateOverrides: [{ date: startDate, totalSeconds: 10800 }, ...weekendOverrides] },
  { name: "기한단축35일", deadlineDate: "2026-11-04", dateOverrides: [] },
];
const baselineFile = new URL("./learning-plan-distribution.baseline.local.json", import.meta.url);
const baselineMode = process.argv.includes("--baseline");
const comparisonMode = process.argv.includes("--compare-baseline");
assert.ok(!(baselineMode && comparisonMode));
const previous = comparisonMode ? JSON.parse(await readFile(baselineFile, "utf8")) : null;
const results = [];
for (const scenario of cases) {
  const days = normalizeLearningPlanDays({ startDate, deadlineDate: scenario.deadlineDate, availableSecondsPerDay: 14400, dateOverrides: scenario.dateOverrides });
  const input = { items, days, progress: [] };
  const schedule = scheduleLearningPlan(input); assert.equal(schedule.kind, "scheduled");
  if (schedule.kind !== "scheduled") throw new Error("실제 카탈로그 입력 편성 실패");
  const candidate: LearningPlanSegmentValidationInput = { ...input, assignments: schedule.assignments };
  checkLearningPlanIndependently({ catalog: items, items: items.map(item => ({ ...item, positionSeconds: 0 })),
    segments: schedule.assignments, capacities: days, dailyUsage: [] });
  const quality = baselineMode ? measureLearningPlanDistribution(candidate) : assertLearningPlanDistribution(candidate);
  const result = { name: scenario.name, input, quality };
  results.push(result);
  const before = previous?.find((entry: { name: string }) => entry.name === scenario.name)?.quality;
  if (before) assert.ok(quality.maxPrefixDeviationSeconds < before.maxPrefixDeviationSeconds, "같은 입력의 기존 집중 배치보다 누적 편차가 줄지 않았습니다.");
  console.log(JSON.stringify({ name: scenario.name, ...(before ? { before: brief(before) } : {}), after: brief(quality) }));
}
if (baselineMode) await writeFile(baselineFile, JSON.stringify(results));
function brief(quality: ReturnType<typeof measureLearningPlanDistribution>) {
  return { lastAssignedDate: quality.lastAssignedDate, assignedDays: quality.assignedAvailableDays,
    maxEmptyAvailableDays: quality.maxEmptyAvailableDays, emptyRunToleranceDays: quality.emptyRunToleranceDays,
    maxPrefixDeviationSeconds: Math.round(quality.maxPrefixDeviationSeconds), prefixToleranceSeconds: quality.prefixToleranceSeconds,
    weekly: quality.weekly.map(week => ({ from: week.startDate, assignedMinutes: Math.round(week.assignedSeconds / 60), idealMinutes: Math.round(week.idealSeconds / 60) })) };
}
function addDays(date: string, days: number) { const value = new Date(date + "T00:00:00Z"); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); }
