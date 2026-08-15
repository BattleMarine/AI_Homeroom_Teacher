export type CurriculumItemKind = "lecture" | "review" | "practice" | "check";
export type CurriculumChangeReason = "initial" | "progress_adjustment" | "remediation" | "teacher_adjustment";
export type StudentCurriculumStatus = "candidate" | "active" | "completed" | "archived";

export type CurriculumItemInput = {
  sourceId: string;
  kind: CurriculumItemKind;
  lessonId: string | null;
  title: string;
  description: string | null;
  conceptTags: string[];
  estimatedMinutes: number;
  required: boolean;
  reason: string | null;
};

export type CurriculumStepInput = {
  sourceId: string;
  title: string;
  goal: string | null;
  conceptTags: string[];
  estimatedMinutes: number;
  items: CurriculumItemInput[];
};

export type CurriculumVersionInput = {
  changeReason: CurriculumChangeReason;
  changeSummary?: string;
  steps: CurriculumStepInput[];
};

export type StudentCurriculumState = Record<string, unknown>;

export type CurriculumPresentation = {
  paceLabel: string;
  description: string;
  recommendedFor: string[];
  teacherComment: string;
};

export type StudentCurriculum = {
  id: string;
  studentId: string;
  subjectCode: string;
  title: string;
  status: StudentCurriculumStatus;
  presentation: CurriculumPresentation;
  currentVersionId: string | null;
  revision: number;
  state: StudentCurriculumState;
};

export type StoredCurriculumItem = CurriculumItemInput & { id: string; sequence: number };
export type StoredCurriculumStep = Omit<CurriculumStepInput, "items"> & { id: string; sequence: number; items: StoredCurriculumItem[] };
export type StoredCurriculumVersion = {
  id: string;
  versionNumber: number;
  changeReason: CurriculumChangeReason;
  changeSummary: string | null;
  steps: StoredCurriculumStep[];
};

export type StudentCurriculumDetail = StudentCurriculum & { currentVersion: StoredCurriculumVersion | null };

export type CurriculumReadModel =
  | { kind: "selection-required" }
  | {
      kind: "active";
      curriculum: StudentCurriculumDetail;
      executionState: { revision: number; state: Record<string, unknown> } | null;
    };

export type VersionSaveResult =
  | { kind: "saved"; curriculum: StudentCurriculumDetail }
  | { kind: "revision-conflict"; currentRevision: number };

export type StudentCurriculumRepository = {
  listForStudent(studentId: string): Promise<StudentCurriculumDetail[]>;
  getById(studentId: string, curriculumId: string): Promise<StudentCurriculumDetail | undefined>;
  seedCandidate(input: {
    id: string;
    studentId: string;
    subjectCode: string;
    title: string;
    presentation: CurriculumPresentation;
    state: StudentCurriculumState;
    version: CurriculumVersionInput;
  }): Promise<void>;
  selectCandidate(studentId: string, curriculumId: string): Promise<StudentCurriculum | undefined>;
  getActiveReadModel(studentId: string, subjectCode: string): Promise<CurriculumReadModel>;
  saveNewVersion(input: {
    studentId: string;
    curriculumId: string;
    expectedRevision: number;
    state: StudentCurriculumState;
    version: CurriculumVersionInput;
  }): Promise<VersionSaveResult | undefined>;
};
