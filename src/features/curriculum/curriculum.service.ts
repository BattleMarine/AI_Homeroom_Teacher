import { curriculums } from "./curriculum.data";
import type {
  Curriculum,
  CurriculumId,
  CurriculumMapStep,
  CurriculumProgressStatus,
  CurriculumStep,
} from "./curriculum.types";

export type CurriculumProgressInput = {
  currentStepId: string;
  completedStepIds?: string[];
  delayedStepIds?: string[];
  weakConcepts?: string[];
};

export function getCurriculums(): Curriculum[] {
  return curriculums;
}

export function getCurriculumById(curriculumId: CurriculumId): Curriculum | undefined {
  return curriculums.find((curriculum) => curriculum.id === curriculumId);
}

export function getRequiredCurriculumById(curriculumId: CurriculumId): Curriculum {
  const curriculum = getCurriculumById(curriculumId);

  if (!curriculum) {
    throw new Error(`존재하지 않는 커리큘럼입니다: ${curriculumId}`);
  }

  return curriculum;
}

export function getInitialStep(curriculum: Curriculum): CurriculumStep {
  return curriculum.steps[0];
}

export function getCurrentStep(
  curriculum: Curriculum,
  currentStepId: string,
): CurriculumStep | undefined {
  return curriculum.steps.find((step) => step.id === currentStepId);
}

export function getRequiredCurrentStep(
  curriculum: Curriculum,
  currentStepId: string,
): CurriculumStep {
  const currentStep = getCurrentStep(curriculum, currentStepId);

  if (!currentStep) {
    throw new Error(`현재 단계를 찾을 수 없습니다: ${currentStepId}`);
  }

  return currentStep;
}

export function getNextStep(
  curriculum: Curriculum,
  currentStepId: string,
): CurriculumStep | undefined {
  const currentIndex = curriculum.steps.findIndex((step) => step.id === currentStepId);

  if (currentIndex < 0) {
    return undefined;
  }

  return curriculum.steps[currentIndex + 1];
}

export function getCurriculumMap(
  curriculum: Curriculum,
  progress: CurriculumProgressInput,
): CurriculumMapStep[] {
  const completedStepIds = new Set(progress.completedStepIds ?? []);
  const delayedStepIds = new Set(progress.delayedStepIds ?? []);
  const weakConcepts = new Set(progress.weakConcepts ?? []);

  return curriculum.steps.map((step) => ({
    id: step.id,
    title: step.title,
    conceptTags: step.conceptTags,
    estimatedMinutes: step.estimatedMinutes,
    status: getStepStatus({
      step,
      currentStepId: progress.currentStepId,
      completedStepIds,
      delayedStepIds,
      weakConcepts,
    }),
  }));
}

function getStepStatus({
  step,
  currentStepId,
  completedStepIds,
  delayedStepIds,
  weakConcepts,
}: {
  step: CurriculumStep;
  currentStepId: string;
  completedStepIds: Set<string>;
  delayedStepIds: Set<string>;
  weakConcepts: Set<string>;
}): CurriculumProgressStatus {
  if (completedStepIds.has(step.id)) {
    return "완료";
  }

  if (delayedStepIds.has(step.id)) {
    return "연기됨";
  }

  if (step.id === currentStepId) {
    return "진행 중";
  }

  const hasWeakConcept = step.conceptTags.some((concept) => weakConcepts.has(concept));

  if (hasWeakConcept) {
    return "보강 필요";
  }

  return "예정";
}
