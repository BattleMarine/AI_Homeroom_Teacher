import type {
  StudentRequestAdjustment,
  StudentRequestAdjustmentInput,
} from "./student-request.types";
import type { StudentProgressState } from "./progress.types";

export function applyStudentRequestToProgress<
  TStudentState extends StudentProgressState,
>({
  studentState,
  requestKind,
  focusConcept,
  currentStepConcepts = [],
}: StudentRequestAdjustmentInput<TStudentState>): StudentRequestAdjustment<TStudentState> {
  const weakConcepts = new Set(studentState.weakConcepts);
  const resolvedFocusConcept = focusConcept ?? currentStepConcepts[0];

  if (requestKind === "confused_concept" && resolvedFocusConcept) {
    weakConcepts.add(resolvedFocusConcept);
  }

  if (requestKind === "review_first") {
    currentStepConcepts.slice(0, 2).forEach((concept) => weakConcepts.add(concept));
  }

  const adjustedStudentState: TStudentState = {
    ...studentState,
    weakConcepts: [...weakConcepts],
  };

  switch (requestKind) {
    case "short_time":
      return {
        adjustedStudentState,
        maxMinutes: 25,
        summary: "오늘 시간이 부족해요",
        teacherNote:
          "오늘은 핵심 보강과 필수 확인만 남기고, 선택 진도는 다음 수업 후보로 넘기겠습니다.",
      };

    case "review_first":
      return {
        adjustedStudentState,
        maxMinutes: 35,
        summary: "오늘은 복습 위주로 하고 싶어요",
        teacherNote:
          "새 진도를 무리해서 밀기보다 현재 단계의 헷갈린 개념을 먼저 안정시키겠습니다.",
      };

    case "confused_concept":
      return {
        adjustedStudentState,
        maxMinutes: 40,
        summary: `${resolvedFocusConcept ?? "현재 개념"}이 아직 헷갈려요`,
        teacherNote:
          "요청한 개념을 취약 개념으로 반영해 오늘 수업 앞쪽에 보강 흐름을 배치하겠습니다.",
      };

    case "reduce_new_lecture":
      return {
        adjustedStudentState,
        maxMinutes: 30,
        summary: "새 강의는 줄이고 싶어요",
        teacherNote:
          "새 강의 비중은 줄이고, 오늘 꼭 필요한 확인과 보강을 중심으로 수업량을 조절하겠습니다.",
      };

    case "default":
    default:
      return {
        adjustedStudentState,
        summary: "기본 편성으로 진행할게요",
        teacherNote:
          "현재 진도와 취약 개념을 기준으로 오늘 수업을 균형 있게 편성하겠습니다.",
      };
  }
}
