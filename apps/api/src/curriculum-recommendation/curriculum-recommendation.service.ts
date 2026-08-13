import type { CourseCatalogLesson, CourseCatalogRepository } from "../course-catalog/course-catalog.types.js";
import type {
  CurriculumRecommendation,
  CurriculumRecommendationInput,
  CurriculumRecommendationService,
  RecommendedCurriculumStep,
  RecommendedSession,
} from "./curriculum-recommendation.types.js";

const defaultAvailableMinutesPerDay = 60;

export function createCurriculumRecommendationService(
  courseCatalogRepository: CourseCatalogRepository,
): CurriculumRecommendationService {
  return {
    async recommend(input) {
      const catalog = input.courseId
        ? await courseCatalogRepository.getCourseCatalog(input.courseId)
        : await courseCatalogRepository.getDefaultCourseCatalog();

      if (!catalog) return { kind: "course-not-found" };

      const availableMinutesPerDay = input.availableMinutesPerDay ?? defaultAvailableMinutesPerDay;
      const completedLessonIds = new Set(input.completedLessonIds ?? []);
      const unitNames = uniqueText(input.unitNames ?? []);
      const weakUnitNames = uniqueText(input.weakUnitNames ?? []);
      const candidateLessons = catalog.lessons
        .filter((lesson) => lesson.lessonType !== "orientation")
        .filter((lesson) => !completedLessonIds.has(lesson.id))
        .filter((lesson) => !input.subjectArea || lesson.subjectAreas.includes(input.subjectArea))
        .filter((lesson) => unitNames.length === 0 || lesson.unitNames.some((unitName) => unitNames.includes(unitName)))
        .sort((left, right) => left.sequence - right.sequence);

      if (candidateLessons.length === 0) return { kind: "no-matching-lessons" };

      const steps = buildSteps(candidateLessons, weakUnitNames);
      const sessions = buildSessions(candidateLessons, availableMinutesPerDay);
      const remainingDurationMinutes = sumMinutes(candidateLessons);
      const requiredAverageMinutesPerDay = input.targetDays
        ? Math.ceil(remainingDurationMinutes / input.targetDays)
        : null;
      const overBudgetLessonCount = sessions.filter((session) => session.exceedsDailyBudget).length;
      const minimumRequiredDays = sessions.length;
      const targetAchievable = input.targetDays
        ? overBudgetLessonCount === 0 &&
          minimumRequiredDays <= input.targetDays &&
          requiredAverageMinutesPerDay !== null &&
          requiredAverageMinutesPerDay <= availableMinutesPerDay
        : null;
      const reasonCodes = createReasonCodes({
        subjectArea: input.subjectArea,
        unitNames,
        completedLessonIds,
        weakUnitNames,
        targetDays: input.targetDays,
        targetAchievable,
        overBudgetLessonCount,
      });

      return {
        kind: "success",
        recommendation: {
          algorithm: "rule-based-v1",
          course: {
            id: catalog.course.id,
            title: catalog.course.title,
            provider: catalog.course.provider,
            instructor: catalog.course.instructor,
            primarySubject: catalog.course.primarySubject,
            includedSubjects: catalog.course.includedSubjects,
            curriculumYear: catalog.course.curriculumYear,
          },
          scope: {
            subjectArea: input.subjectArea ?? null,
            unitNames,
            completedLessonIds: [...completedLessonIds],
            weakUnitNames,
          },
          summary: {
            remainingLessonCount: candidateLessons.length,
            remainingDurationMinutes,
            minimumRequiredDays,
            availableMinutesPerDay,
            targetDays: input.targetDays ?? null,
          },
          feasibility: {
            targetDateConfigured: Boolean(input.targetDays),
            targetAchievable,
            requiredAverageMinutesPerDay,
            overBudgetLessonCount,
          },
          steps,
          sessions,
          reasonCodes,
          teacherSummary: createTeacherSummary({
            courseTitle: catalog.course.title,
            remainingLessonCount: candidateLessons.length,
            remainingDurationMinutes,
            availableMinutesPerDay,
            targetDays: input.targetDays,
            targetAchievable,
            overBudgetLessonCount,
          }),
        },
      };
    },
  };
}

function buildSteps(lessons: CourseCatalogLesson[], weakUnitNames: string[]): RecommendedCurriculumStep[] {
  const steps: RecommendedCurriculumStep[] = [];
  let currentLessons: CourseCatalogLesson[] = [];
  let currentKey = "";

  lessons.forEach((lesson) => {
    const stepKey = lesson.unitNames.join("|") || "unclassified";

    if (currentLessons.length > 0 && currentKey !== stepKey) {
      steps.push(createStep(currentLessons, weakUnitNames));
      currentLessons = [];
    }

    currentKey = stepKey;
    currentLessons.push(lesson);
  });

  if (currentLessons.length > 0) steps.push(createStep(currentLessons, weakUnitNames));

  return steps;
}

function createStep(lessons: CourseCatalogLesson[], weakUnitNames: string[]): RecommendedCurriculumStep {
  const firstLesson = lessons[0];
  const unitNames = firstLesson.unitNames;

  return {
    id: `step-${firstLesson.sequence}-${lessons.at(-1)?.sequence ?? firstLesson.sequence}`,
    title: unitNames.length > 0 ? unitNames.join(" · ") : "분류되지 않은 강의",
    subjectAreas: uniqueText(lessons.flatMap((lesson) => lesson.subjectAreas)),
    lessonIds: lessons.map((lesson) => lesson.id),
    lessonCount: lessons.length,
    estimatedMinutes: sumMinutes(lessons),
    weakUnit: unitNames.some((unitName) => weakUnitNames.includes(unitName)),
  };
}

function buildSessions(lessons: CourseCatalogLesson[], availableMinutesPerDay: number): RecommendedSession[] {
  const sessions: RecommendedSession[] = [];
  let pendingLessons: CourseCatalogLesson[] = [];
  let pendingMinutes = 0;

  function appendPendingSession() {
    if (pendingLessons.length === 0) return;

    sessions.push({
      dayIndex: sessions.length + 1,
      lessonIds: pendingLessons.map((lesson) => lesson.id),
      lessons: pendingLessons.map((lesson) => ({
        id: lesson.id,
        sequence: lesson.sequence,
        title: lesson.title,
        lessonType: lesson.lessonType,
        unitNames: lesson.unitNames,
        estimatedMinutes: toMinutes(lesson.duration.seconds),
      })),
      estimatedMinutes: pendingMinutes,
      exceedsDailyBudget: pendingMinutes > availableMinutesPerDay,
    });
    pendingLessons = [];
    pendingMinutes = 0;
  }

  lessons.forEach((lesson) => {
    const lessonMinutes = toMinutes(lesson.duration.seconds);

    if (pendingLessons.length > 0 && pendingMinutes + lessonMinutes > availableMinutesPerDay) {
      appendPendingSession();
    }

    pendingLessons.push(lesson);
    pendingMinutes += lessonMinutes;
  });

  appendPendingSession();
  return sessions;
}

function createReasonCodes({
  subjectArea,
  unitNames,
  completedLessonIds,
  weakUnitNames,
  targetDays,
  targetAchievable,
  overBudgetLessonCount,
}: {
  subjectArea: string | undefined;
  unitNames: string[];
  completedLessonIds: Set<string>;
  weakUnitNames: string[];
  targetDays: number | undefined;
  targetAchievable: boolean | null;
  overBudgetLessonCount: number;
}): string[] {
  const reasonCodes = ["catalog_sequence_preserved", "orientation_excluded"];

  if (subjectArea) reasonCodes.push("subject_area_filtered");
  if (unitNames.length > 0) reasonCodes.push("unit_filtered");
  if (completedLessonIds.size > 0) reasonCodes.push("completed_lessons_excluded");
  if (weakUnitNames.length > 0) reasonCodes.push("weak_unit_review_signal");
  if (targetDays) reasonCodes.push(targetAchievable ? "target_days_achievable" : "target_days_at_risk");
  if (overBudgetLessonCount > 0) reasonCodes.push("single_lesson_exceeds_daily_budget");

  return reasonCodes;
}

function createTeacherSummary({
  courseTitle,
  remainingLessonCount,
  remainingDurationMinutes,
  availableMinutesPerDay,
  targetDays,
  targetAchievable,
  overBudgetLessonCount,
}: {
  courseTitle: string;
  remainingLessonCount: number;
  remainingDurationMinutes: number;
  availableMinutesPerDay: number;
  targetDays: number | undefined;
  targetAchievable: boolean | null;
  overBudgetLessonCount: number;
}): string {
  const summary = `${courseTitle}에서 남은 ${remainingLessonCount}개 강의를 순서대로 묶었습니다. 총 예상 시간은 ${remainingDurationMinutes}분입니다.`;

  if (targetDays && targetAchievable) {
    return `${summary} 하루 ${availableMinutesPerDay}분 기준으로 목표 일수 안에 진행 가능한 편성입니다.`;
  }

  if (targetDays && !targetAchievable) {
    return `${summary} 현재 하루 가능 시간으로는 목표 일수 안에 모두 듣기 어렵습니다. 목표일을 늘리거나 하루 가능 시간을 조정하는 편성안을 함께 검토하겠습니다.`;
  }

  if (overBudgetLessonCount > 0) {
    return `${summary} 일부 단일 강의가 하루 가능 시간을 넘으므로, 해당 강의는 한 수업으로 표시하고 실제 시청 분할 여부는 이후 영상 정보로 조율하겠습니다.`;
  }

  return `${summary} 하루 ${availableMinutesPerDay}분 기준의 학습 세션으로 편성했습니다.`;
}

function sumMinutes(lessons: CourseCatalogLesson[]): number {
  return lessons.reduce((total, lesson) => total + toMinutes(lesson.duration.seconds), 0);
}

function toMinutes(seconds: number): number {
  return Math.ceil(seconds / 60);
}

function uniqueText(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
