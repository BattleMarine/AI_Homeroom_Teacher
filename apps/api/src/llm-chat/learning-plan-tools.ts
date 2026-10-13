import type { CourseCatalogRepository } from "../course-catalog/course-catalog.types.js";
import { LearningPlanInputError } from "../learning-plan/learning-plan.calendar.js";
import { LearningPlanRepositoryError, type LearningPlanSelection } from "../learning-plan/learning-plan.repository.js";
import { createLearningPlanService, type CreateLearningPlanInput, type RebalanceLearningPlanInput, type AdjustLearningPlanInput } from "../learning-plan/learning-plan.service.js";
import { learningPlanCreateSchema, learningPlanRebalanceSchema, learningPlanAdjustSchema } from "../learning-plan/learning-plan.schemas.js";
import { buildLearningPlanView } from "./learning-plan-view.js";

export type PlanService = ReturnType<typeof createLearningPlanService>;
type Schema = { type?: string; properties?: Record<string, Schema>; required?: string[]; additionalProperties?: boolean;
  items?: Schema; minItems?: number; maxItems?: number; minLength?: number; maxLength?: number; minimum?: number; maximum?: number; pattern?: string; enum?: unknown[]; anyOf?: Schema[] };
const object = (properties: Record<string, Schema>, required: string[] = []): Schema => ({ type: "object", properties, required, additionalProperties: false });
function omitServerFields(schema: Schema): Schema {
  const properties = Object.fromEntries(Object.entries(schema.properties!).filter(([key]) => !["studentId", "expectedBasis", "selections"].includes(key)));
  return object(properties, (schema.required ?? []).filter((key) => key !== "studentId" && key !== "expectedBasis" && key !== "selections"));
}
const selectionSchema = learningPlanCreateSchema.properties.selections as Schema;
const id: Schema = { type: "string", minLength: 1, maxLength: 200 };
const definitions = {
  list_courses: { description: "실제 강좌 목록 조회. query는 과목명 또는 강좌명 검색어 하나다. 수학·국어·영어 등을 한 문자열로 묶어 검색하지 말고 각각 조회하거나 생략해 전체 목록을 본다. 후보가 여러 개면 사용자에게 강좌를 확인한다. 실제 courseId·subjectCode를 사용한다.", parameters: object({ query: { type: "string", minLength: 1, maxLength: 200 } }) },
  get_course_catalog: { description: "실제 강좌의 강의 식별자·순서·소요 시간을 조회한다. 없는 강좌를 만들지 않는다.", parameters: object({ courseId: id }, ["courseId"]) },
  read_current_plan: { description: "결속 학생의 현재 전체 계획·강의명·강좌명·강의번호·예정 날짜/구간·실제 진도·오늘 진행 시간 조회. 명시 이동·교환 대상은 날짜와 강의명/번호를 대조해 segmentKey를 찾는다. 같은 강의가 여러 날짜에 이어보기로 배정됐거나 대상이 여러 개면 질문하며 임의로 첫 구간을 고르지 않는다.", parameters: object({}) },
  propose_create_plan: { description: "최초 전체 계획 제안. 선택 강좌·마감일·하루 총시간은 사용자에게 명시적으로 받은 값이어야 한다. 정보가 부족하면 먼저 질문한다. 시작일 기본값은 서울 오늘. 저장 확정은 별도 UI만 가능하다.", parameters: object({ ...omitServerFields(learningPlanCreateSchema as Schema).properties, selections: selectionSchema }, ["selections", "deadlineDate", "availableSecondsPerDay"]) },
  propose_adjust_plan: { description: "사용자가 명시한 예정 구간의 이동·교환만 제안한다. 충돌 시 별도 전체 재편성을 안내한다. 구간은 현재 조회에서 확인한다.", parameters: omitServerFields(learningPlanAdjustSchema as Schema) },
  propose_rebalance_plan: { description: "전체 남은 계획 재편성 제안. selectionMode keep은 기존 과목 유지, add는 기존에 합집합 추가, remove/replace는 사용자가 명시적으로 삭제/교체 요청한 경우만 사용한다. 모호하면 질문한다. 오늘만 시간은 todayTime(total/additional), 평소 시간은 availableSecondsPerDay. additional 덧셈은 서버가 실제 기록으로 처리한다. 완료·피드백은 보존한다.", parameters: object({ ...omitServerFields(learningPlanRebalanceSchema as Schema).properties,
    selectionMode: { type: "string", enum: ["keep", "add", "remove", "replace"] }, selections: { ...selectionSchema, minItems: 0 } }, ["selectionMode"]) },
};
export const learningPlanTools = Object.entries(definitions).map(([name, value]) => ({ type: "function" as const, function: { name, ...value } }));
export type PlanToolName = keyof typeof definitions;
export function validateToolArguments(name: string, value: unknown): asserts value is Record<string, unknown> {
  const definition = definitions[name as PlanToolName];
  if (!Object.hasOwn(definitions, name) || !definition || !matches(definition.parameters, value)) throw new LearningPlanInputError("INVALID_TOOL_ARGUMENTS", "지원하지 않는 도구 또는 잘못된 구조화 인수입니다. 필요한 조건을 다시 확인해주세요.");
}
/** 이 파일의 제한된 스키마 키워드만 검사한다. 타입 강제 변환·추가 필드 제거를 하지 않는다. */
function matches(schema: Schema, value: unknown): boolean {
  if (schema.anyOf) return schema.anyOf.some((part) => matches(part, value));
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    return (schema.required ?? []).every((key) => Object.hasOwn(record, key)) && Object.entries(record).every(([key, entry]) =>
      Object.hasOwn(schema.properties ?? {}, key) && matches(schema.properties![key], entry));
  }
  if (schema.type === "array") return Array.isArray(value) && value.length >= (schema.minItems ?? 0) && value.length <= (schema.maxItems ?? Infinity) && value.every((entry) => matches(schema.items!, entry));
  if (schema.type === "string") return typeof value === "string" && value.length >= (schema.minLength ?? 0) && value.length <= (schema.maxLength ?? Infinity) && (!schema.pattern || new RegExp(schema.pattern).test(value));
  if (schema.type === "integer") return typeof value === "number" && Number.isSafeInteger(value) && value >= (schema.minimum ?? -Infinity) && value <= (schema.maximum ?? Infinity);
  return schema.type === "null" && value === null;
}
export type ProposalCard = Extract<Awaited<ReturnType<PlanService["create"]>>, { kind: "proposed" }>;
export type ToolResult = { tool: string; kind: string; code?: string; message?: string; issues?: unknown; alternatives?: unknown };
export type ToolExecution = { modelResult: unknown; result: ToolResult; card?: ProposalCard };
export type PlanToolSession = { execute(name: string, args: Record<string, unknown>): Promise<ToolExecution> };

export function createPlanToolSession(studentId: string, service: PlanService, catalog: CourseCatalogRepository): PlanToolSession {
  let current: Awaited<ReturnType<PlanService["read"]>> | undefined;
  let proposalAttempted = false;
  async function read() { return current ??= await service.read({ studentId }); }
  return { async execute(name, args) {
    validateToolArguments(name, args);
    try {
      if (name === "list_courses") {
        const query = typeof args.query === "string" ? args.query.toLocaleLowerCase() : "";
        const courses = (await catalog.listCourses()).filter((course) => !query || `${course.title} ${course.primarySubject} ${course.includedSubjects.join(" ")}`.toLocaleLowerCase().includes(query))
          .map((course) => ({ courseId: course.id, subjectCode: course.primarySubject, includedSubjects: course.includedSubjects,
            title: course.title, lessonCount: course.lessonCount, totalDurationSeconds: course.totalDurationSeconds }));
        return { modelResult: { courses }, result: { tool: name, kind: "read" } };
      }
      if (name === "get_course_catalog") {
        const found = await catalog.getCourseCatalog(args.courseId as string);
        if (!found) throw new LearningPlanRepositoryError("NOT_FOUND", "요청한 강좌가 없습니다.");
        return { modelResult: { courseId: found.course.id, subjectCode: found.course.primarySubject, title: found.course.title,
          lessons: found.lessons.map((lesson) => ({ lessonId: lesson.id, sequence: lesson.sequence, title: lesson.title, lessonType: lesson.lessonType, durationSeconds: lesson.duration.seconds })) }, result: { tool: name, kind: "read" } };
      }
      if (name === "read_current_plan") {
        const plan = await read();
        const view = buildLearningPlanView(plan);
        return { modelResult: { conditions: plan.version.candidate.conditions, selections: plan.version.candidate.catalogSnapshot.map(({ subjectCode, catalog }) => ({ subjectCode, courseId: catalog.course.id, title: catalog.course.title })),
          items: view.items.map(({ feedback: _feedback, feedbackSubmittedAt: _feedbackSubmittedAt, completedAt: _completedAt, ...item }) => item),
          assignments: view.assignments, days: view.days, todayDate: view.todayDate,
          progress: plan.progress.map(({ itemKey, positionSeconds, carryoverSinceDate }) => ({ itemKey, positionSeconds, carryoverSinceDate })), dailyUsage: plan.dailyUsage }, result: { tool: name, kind: "read" } };
      }
      if (proposalAttempted) throw new LearningPlanInputError("PROPOSAL_LIMIT", "한 대화 요청에는 하나의 제안만 만듭니다. 조건을 확인한 후 새 요청으로 진행해주세요.");
      proposalAttempted = true;
      let outcome: Awaited<ReturnType<PlanService["create"] | PlanService["adjust"]>>;
      if (name === "propose_create_plan") outcome = await service.create({ ...args, studentId } as CreateLearningPlanInput);
      else {
        const plan = await read();
        const protectedFields = { studentId, planId: plan.plan!.planId, expectedBasis: plan.basis };
        if (name === "propose_adjust_plan") outcome = await service.adjust({ ...args, ...protectedFields } as AdjustLearningPlanInput);
        else {
          const { selectionMode, selections: supplied, ...conditions } = args;
          const old = plan.version.candidate.catalogSnapshot.map(({ subjectCode, catalog }) => ({ subjectCode, courseId: catalog.course.id }));
          if ((selectionMode === "keep" && supplied !== undefined) || (selectionMode !== "keep" && !Array.isArray(supplied))) throw new LearningPlanInputError("INVALID_SELECTION_MODE", "유지에는 강좌 목록을 보내지 않고 추가·삭제·교체에는 명시적인 목록을 지정해주세요.");
          const choices = (supplied ?? []) as LearningPlanSelection[];
          if ((selectionMode === "add" || selectionMode === "remove") && !choices.length) throw new LearningPlanInputError("INVALID_SELECTION_MODE", "추가·삭제할 강좌를 명시해주세요.");
          if (new Set(choices.map((s) => s.courseId)).size !== choices.length) throw new LearningPlanInputError("DUPLICATE_COURSE_ID", "강좌를 중복 지정하지 마세요.");
          for (const choice of choices) {
            const existing = old.find((s) => s.courseId === choice.courseId);
            if ((existing && existing.subjectCode !== choice.subjectCode) || (selectionMode === "remove" && !existing)) throw new LearningPlanInputError("SUBJECT_COURSE_MISMATCH", "현재 강좌의 과목·식별자와 일치해야 합니다.");
          }
          const selections = selectionMode === "keep" ? old : selectionMode === "replace" ? choices : selectionMode === "add" ? [...old, ...choices.filter((choice) => !old.some((s) => s.courseId === choice.courseId))] : old.filter((s) => !choices.some((choice) => choice.courseId === s.courseId));
          outcome = await service.rebalance({ ...conditions, ...protectedFields, selections } as RebalanceLearningPlanInput);
        }
      }
      if (outcome.kind === "proposed") return { card: outcome, result: { tool: name, kind: "proposed" }, modelResult: {
        kind: "proposed", stateChanged: false, requiresUserConfirmation: true, conditions: outcome.candidate.conditions, diff: outcome.diff, warnings: outcome.warnings,
        assignmentCount: outcome.candidate.assignments.length, scheduledSeconds: outcome.candidate.assignments.reduce((sum, a) => sum + a.durationSeconds, 0) } };
      return { modelResult: outcome, result: { tool: name, kind: outcome.kind, ...("code" in outcome ? { code: outcome.code } : {}), ...("issues" in outcome ? { issues: outcome.issues } : {}), ...("alternatives" in outcome ? { alternatives: outcome.alternatives } : {}) } };
    } catch (error) {
      if (error instanceof LearningPlanInputError || error instanceof LearningPlanRepositoryError) {
        const result = { tool: name, kind: "error", code: error.code, message: error.message };
        return { modelResult: result, result };
      }
      throw error;
    }
  } };
}
