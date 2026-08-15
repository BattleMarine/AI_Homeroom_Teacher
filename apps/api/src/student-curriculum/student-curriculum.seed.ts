import type { CourseCatalog } from "../course-catalog/course-catalog.types.js";
import { mockCurriculums } from "../progress/progress.mock-data.js";
import type { CurriculumDefinition } from "../progress/progress.types.js";
import type { CurriculumVersionInput, StudentCurriculumRepository } from "./student-curriculum.types.js";

const demoStudentId = "000";
const subjectCode = "math-logarithm";

export async function seedDemoStudentCurricula(
  repository: StudentCurriculumRepository,
  catalog: CourseCatalog,
) {
  const playableLessonIds = catalog.lessons.map((lesson) => lesson.id);
  if (playableLessonIds.length === 0) {
    throw new Error("커리큘럼 lecture 항목에 연결할 강의가 없습니다.");
  }

  for (const curriculum of mockCurriculums) {
    await repository.seedCandidate({
      id: curriculum.id,
      studentId: demoStudentId,
      subjectCode,
      title: curriculum.title,
      state: createInitialState(curriculum),
      version: createVersion(curriculum, playableLessonIds),
    });
  }
}

function createInitialState(curriculum: CurriculumDefinition) {
  return {
    currentStepId: curriculum.initialProgress.currentStepId,
    completedStepIds: curriculum.initialProgress.completedStepIds,
    delayedStepIds: [],
    weakConcepts: curriculum.initialProgress.weakConcepts,
    completedLessonItemIds: [],
    deferredLessonItemIds: [],
    lowFocusRecorded: false,
    maxSessionMinutes: 45,
  };
}

function createVersion(curriculum: CurriculumDefinition, playableLessonIds: string[]): CurriculumVersionInput {
  let lectureIndex = 0;
  return {
    changeReason: "initial",
    changeSummary: "데모 Mock 커리큘럼 초기 구성",
    steps: curriculum.steps.map((step) => ({
      sourceId: step.id,
      title: step.title,
      goal: step.goal,
      conceptTags: step.conceptTags,
      estimatedMinutes: step.estimatedMinutes,
      items: step.items.map((item) => ({
        sourceId: item.id,
        kind: item.kind,
        lessonId: item.kind === "lecture" ? playableLessonIds[lectureIndex++ % playableLessonIds.length] : null,
        title: item.title,
        description: item.description,
        conceptTags: item.conceptTags,
        estimatedMinutes: item.estimatedMinutes,
        required: item.required,
        reason: item.reason,
      })),
    })),
  };
}
