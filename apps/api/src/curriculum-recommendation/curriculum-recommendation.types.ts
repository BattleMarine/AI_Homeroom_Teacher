import type { CourseCatalogCourse, CourseCatalogLesson } from "../course-catalog/course-catalog.types.js";

export type CurriculumRecommendationInput = {
  courseId?: string;
  subjectArea?: string;
  unitNames?: string[];
  completedLessonIds?: string[];
  weakUnitNames?: string[];
  availableMinutesPerDay?: number;
  targetDays?: number;
};

export type CurriculumRecommendation = {
  algorithm: "rule-based-v1";
  course: Pick<
    CourseCatalogCourse,
    "id" | "title" | "provider" | "instructor" | "primarySubject" | "includedSubjects" | "curriculumYear"
  >;
  scope: {
    subjectArea: string | null;
    unitNames: string[];
    completedLessonIds: string[];
    weakUnitNames: string[];
  };
  summary: {
    remainingLessonCount: number;
    remainingDurationMinutes: number;
    minimumRequiredDays: number;
    availableMinutesPerDay: number;
    targetDays: number | null;
  };
  feasibility: {
    targetDateConfigured: boolean;
    targetAchievable: boolean | null;
    requiredAverageMinutesPerDay: number | null;
    overBudgetLessonCount: number;
  };
  steps: RecommendedCurriculumStep[];
  sessions: RecommendedSession[];
  reasonCodes: string[];
  teacherSummary: string;
};

export type RecommendedCurriculumStep = {
  id: string;
  title: string;
  subjectAreas: string[];
  lessonIds: string[];
  lessonCount: number;
  estimatedMinutes: number;
  weakUnit: boolean;
};

export type RecommendedSession = {
  dayIndex: number;
  lessonIds: string[];
  lessons: Array<Pick<CourseCatalogLesson, "id" | "sequence" | "title" | "lessonType" | "unitNames"> & { estimatedMinutes: number }>;
  estimatedMinutes: number;
  exceedsDailyBudget: boolean;
};

export type CurriculumRecommendationService = {
  recommend(input: CurriculumRecommendationInput): Promise<
    | { kind: "success"; recommendation: CurriculumRecommendation }
    | { kind: "course-not-found" }
    | { kind: "no-matching-lessons" }>;
};
