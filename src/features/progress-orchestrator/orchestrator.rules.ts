import type { CurriculumStep } from "../curriculum";
import type { LessonItem, LessonItemKind } from "../../types/shared.types";

export const DEFAULT_TODAY_SESSION_MAX_MINUTES = 45;

const lessonKindPriority: Record<LessonItemKind, number> = {
  review: 1,
  check: 2,
  lecture: 3,
  practice: 4,
};

export function getRelatedWeakConcepts(step: CurriculumStep, weakConcepts: string[]): string[] {
  const stepConcepts = new Set(step.conceptTags);

  return weakConcepts.filter((concept) => stepConcepts.has(concept));
}

export function hasWeakConceptReviewItem(items: LessonItem[], weakConcepts: string[]): boolean {
  const weakConceptSet = new Set(weakConcepts);

  return items.some(
    (item) =>
      item.kind === "review" && item.conceptTags.some((concept) => weakConceptSet.has(concept)),
  );
}

export function createWeakConceptReviewItem(weakConcepts: string[]): LessonItem {
  const reviewConcepts = weakConcepts.slice(0, 2);

  return {
    id: `auto-review-${reviewConcepts.join("-")}`,
    kind: "review",
    title: `${reviewConcepts.join("·")} 보강 카드`,
    description: "오늘 새 진도 전에 헷갈린 개념을 짧게 복구합니다.",
    conceptTags: reviewConcepts,
    estimatedMinutes: reviewConcepts.length > 1 ? 10 : 8,
    required: true,
    reason: "취약 개념 보강",
  };
}

export function orderLessonItemsForToday(items: LessonItem[], weakConcepts: string[]): LessonItem[] {
  const weakConceptSet = new Set(weakConcepts);

  return [...items].sort((left, right) => {
    const leftPriority = getLessonPriority(left, weakConceptSet);
    const rightPriority = getLessonPriority(right, weakConceptSet);

    return leftPriority - rightPriority;
  });
}

export function fitLessonItemsToMaxMinutes(
  items: LessonItem[],
  maxMinutes: number,
): {
  selectedItems: LessonItem[];
  delayedItems: LessonItem[];
} {
  const selectedItems = [...items];
  const delayedItems: LessonItem[] = [];

  while (sumLessonMinutes(selectedItems) > maxMinutes) {
    const removableIndex = findLastRemovableItemIndex(selectedItems);

    if (removableIndex < 0) {
      break;
    }

    const [removedItem] = selectedItems.splice(removableIndex, 1);
    delayedItems.unshift(removedItem);
  }

  return {
    selectedItems,
    delayedItems,
  };
}

export function sumLessonMinutes(items: LessonItem[]): number {
  return items.reduce((total, item) => total + item.estimatedMinutes, 0);
}

function getLessonPriority(item: LessonItem, weakConceptSet: Set<string>): number {
  const hasWeakConcept = item.conceptTags.some((concept) => weakConceptSet.has(concept));

  if (item.kind === "review" && hasWeakConcept) {
    return 0;
  }

  if (item.kind === "check" && hasWeakConcept) {
    return 1.5;
  }

  return lessonKindPriority[item.kind];
}

function findLastRemovableItemIndex(items: LessonItem[]): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (!items[index].required) {
      return index;
    }
  }

  return -1;
}
