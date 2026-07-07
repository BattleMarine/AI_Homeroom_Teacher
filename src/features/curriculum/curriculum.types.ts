import type { LessonItem } from "../../types/shared.types";

export type CurriculumId = "stable-log" | "compressed-log" | "practice-log";

export type CurriculumPace = "안정형" | "압축형" | "문제적용형";

export type CurriculumStep = {
  id: string;
  title: string;
  goal: string;
  conceptTags: string[];
  estimatedMinutes: number;
  defaultItems: LessonItem[];
};

export type Curriculum = {
  id: CurriculumId;
  title: string;
  pace: CurriculumPace;
  description: string;
  recommendedFor: string[];
  teacherComment: string;
  steps: CurriculumStep[];
};

export type CurriculumProgressStatus =
  | "완료"
  | "진행 중"
  | "예정"
  | "보강 필요"
  | "연기됨";

export type CurriculumMapStep = {
  id: string;
  title: string;
  conceptTags: string[];
  estimatedMinutes: number;
  status: CurriculumProgressStatus;
};
