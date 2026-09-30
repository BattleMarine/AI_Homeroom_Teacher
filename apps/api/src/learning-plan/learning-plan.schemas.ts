const id = { type: "string", minLength: 1, maxLength: 200 } as const;
const date = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" } as const;
const seconds = { type: "integer", minimum: 0, maximum: 86400 } as const;
const object = (properties: Record<string, unknown>, required: string[]) => ({ type: "object", properties, required, additionalProperties: false });
export const learningPlanBasisSchema = object({ planId: id, currentVersionId: id, planRevision: { type: "integer", minimum: 0 },
  completionRevision: { type: "integer", minimum: 0 }, catalogHash: { type: "string", pattern: "^[a-f0-9]{64}$" } }, ["planId", "currentVersionId", "planRevision", "completionRevision", "catalogHash"]);
// 최초 제안의 부재 기준은 저장 제안에서 전달된다.
learningPlanBasisSchema.properties.planId = { anyOf: [id, { type: "null" }] };
learningPlanBasisSchema.properties.currentVersionId = { anyOf: [id, { type: "null" }] };
const selections = { type: "array", minItems: 1, maxItems: 100, items: object({ subjectCode: id, courseId: id }, ["subjectCode", "courseId"]) };
const overrides = { type: "array", maxItems: 3650, items: object({ date, totalSeconds: seconds }, ["date", "totalSeconds"]) };
export const learningPlanFeedbackSchema = object({ understandingLevel: { type: "integer", minimum: 1, maximum: 5 },
  focusLevel: { type: "integer", minimum: 1, maximum: 5 }, weakConcepts: { type: "array", maxItems: 50, items: { type: "string", minLength: 1, maxLength: 200 } },
  comment: { type: "string", maxLength: 2000 } }, ["understandingLevel", "focusLevel"]);
export const learningPlanCreateSchema = object({ studentId: id, selections, startDate: date, deadlineDate: date,
  availableSecondsPerDay: seconds, dateOverrides: overrides }, ["studentId", "selections", "deadlineDate", "availableSecondsPerDay"]);
export const learningPlanRebalanceSchema = object({ studentId: id, expectedBasis: learningPlanBasisSchema, fromDate: date, selections: { ...selections, minItems: 0 },
  deadlineDate: date, availableSecondsPerDay: seconds, dateOverrides: overrides,
  todayTime: object({ mode: { type: "string", enum: ["total", "additional"] }, seconds }, ["mode", "seconds"]) }, ["studentId", "expectedBasis"]);
export const learningPlanAdjustSchema = object({ studentId: id, expectedBasis: learningPlanBasisSchema,
  moves: { type: "array", minItems: 1, maxItems: 1000, items: object({ segmentKey: { type: "string", minLength: 1, maxLength: 500 }, date,
    order: { type: "integer", minimum: 0, maximum: 100000 } }, ["segmentKey", "date", "order"]) } }, ["studentId", "expectedBasis", "moves"]);
export const learningPlanConfirmSchema = object({ studentId: id, expectedBasis: learningPlanBasisSchema }, ["studentId", "expectedBasis"]);
export const learningPlanProgressSchema = object({ studentId: id, itemKey: id, idempotencyKey: id,
  positionSeconds: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER }, spentSeconds: seconds, feedback: learningPlanFeedbackSchema },
  ["studentId", "itemKey", "idempotencyKey", "positionSeconds", "spentSeconds"]);
export const learningPlanFeedbackRequestSchema = object({ studentId: id, itemKey: id, idempotencyKey: id, feedback: learningPlanFeedbackSchema },
  ["studentId", "itemKey", "idempotencyKey", "feedback"]);
export const learningPlanQuerySchema = object({ studentId: id, date, versionId: id }, ["studentId"]);
