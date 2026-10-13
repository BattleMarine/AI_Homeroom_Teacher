import assert from "node:assert/strict";
import test from "node:test";
import type { CourseCatalog, CourseCatalogLesson } from "../src/course-catalog/course-catalog.types.js";
import { normalizeLearningPlanCatalogs } from "../src/learning-plan/learning-plan.catalog.js";
import { validateLearningPlan } from "../src/learning-plan/learning-plan.validation.js";
import type { LearningPlanCatalogItem, LearningPlanValidationInput } from "../src/learning-plan/learning-plan.types.js";

function catalog(courseId: string, lessons: Array<Pick<CourseCatalogLesson, "id" | "sequence" | "lessonType"> & { seconds: number }>): CourseCatalog {
  return {
    course: { id: courseId, provider: { id: "provider", name: "검증" }, instructor: { id: "teacher", name: "검증" },
      title: "카탈로그 검증", primarySubject: "임의 과목", includedSubjects: [], curriculumYear: 2026,
      lessonCount: lessons.length, orientationCount: 0, contentLessonCount: lessons.length,
      totalDurationSeconds: 0, sourceUrl: null, status: "metadata_only" },
    lessons: lessons.map((lesson) => ({ id: lesson.id, courseId, sequence: lesson.sequence, lectureNumber: null,
      title: lesson.id, lessonType: lesson.lessonType, subjectAreas: [], unitNames: [],
      duration: { display: "표시값은 편성에 사용하지 않음", seconds: lesson.seconds }, sourceUrl: null, playbackTargetId: null })),
  };
}

function input(): LearningPlanValidationInput {
  const items: LearningPlanCatalogItem[] = [
    { lessonId: "math:1", subjectCode: "math", courseId: "math-course", sequence: 2, durationSeconds: 1201, lessonType: "lecture" },
    { lessonId: "math:2", subjectCode: "math", courseId: "math-course", sequence: 4, durationSeconds: 601, lessonType: "mock_exam" },
    { lessonId: "korean:1", subjectCode: "korean", courseId: "korean-course", sequence: 1, durationSeconds: 600, lessonType: "lecture" },
  ];
  return {
    items,
    days: [{ date: "2026-10-01", capacitySeconds: 1801 }, { date: "2026-10-02", capacitySeconds: 601 }],
    assignments: [
      { lessonId: "math:1", subjectCode: "math", courseId: "math-course", date: "2026-10-01", order: 0, durationSeconds: 1201 },
      { lessonId: "korean:1", subjectCode: "korean", courseId: "korean-course", date: "2026-10-01", order: 1, durationSeconds: 600 },
      { lessonId: "math:2", subjectCode: "math", courseId: "math-course", date: "2026-10-02", order: 0, durationSeconds: 601 },
    ],
  };
}

function issueCodes(value: ReturnType<typeof validateLearningPlan> | ReturnType<typeof normalizeLearningPlanCatalogs>) {
  assert.equal(value.kind, "invalid");
  if (value.kind !== "invalid") throw new Error("실패해야 하는 입력이 통과했습니다.");
  return value.issues.map((issue) => issue.code);
}

test("카탈로그 정규화는 원본 ID·초와 순서를 보존하고 명시한 유형의 제외 근거를 반환한다", () => {
  const original = catalog("course", [
    { id: "course:exam", sequence: 8, lessonType: "mock_exam", seconds: 601 },
    { id: "course:ot", sequence: 1, lessonType: "orientation", seconds: 193 },
    { id: "course:lecture", sequence: 3, lessonType: "lecture", seconds: 1201 },
  ]);
  const before = structuredClone(original);
  const result = normalizeLearningPlanCatalogs([{ subjectCode: "custom-subject", catalog: original }], ["lecture", "mock_exam"]);
  assert.equal(result.kind, "normalized");
  if (result.kind !== "normalized") return;
  assert.deepEqual(result.items.map((item) => [item.lessonId, item.sequence, item.durationSeconds]),
    [["course:lecture", 3, 1201], ["course:exam", 8, 601]]);
  assert.equal(result.totalDurationSeconds, 1802);
  assert.deepEqual(result.excludedItems.map((item) => [item.lessonId, item.reason]), [["course:ot", "lesson-type-excluded"]]);
  assert.deepEqual(original, before);
  const includingOrientation = normalizeLearningPlanCatalogs([{ subjectCode: "custom-subject", catalog: original }],
    ["orientation", "lecture", "mock_exam"]);
  assert.equal(includingOrientation.kind, "normalized");
  if (includingOrientation.kind === "normalized") assert.equal(includingOrientation.totalDurationSeconds, 1995);
});

test("카탈로그 중복 ID·강좌 내 순서·잘못된 강좌 참조는 각각 거절한다", () => {
  const original = catalog("course", [{ id: "same", sequence: 1, lessonType: "lecture", seconds: 60 }]);
  assert.ok(issueCodes(normalizeLearningPlanCatalogs([
    { subjectCode: "one", catalog: original }, { subjectCode: "two", catalog: original },
  ], ["lecture"])).includes("DUPLICATE_COURSE_ID"));
  const duplicate = catalog("course", [
    { id: "same", sequence: 1, lessonType: "lecture", seconds: 60 },
    { id: "same", sequence: 1, lessonType: "lecture", seconds: 60 },
  ]);
  const codes = issueCodes(normalizeLearningPlanCatalogs([{ subjectCode: "one", catalog: duplicate }], ["lecture"]));
  assert.ok(codes.includes("DUPLICATE_LESSON_ID"));
  assert.ok(codes.includes("DUPLICATE_SEQUENCE"));
  const mismatched = structuredClone(original);
  mismatched.lessons[0].courseId = "another-course";
  assert.ok(issueCodes(normalizeLearningPlanCatalogs([{ subjectCode: "one", catalog: mismatched }], ["lecture"]))
    .includes("COURSE_LESSON_MISMATCH"));
});

test("카탈로그의 0·음수·소수·무한·안전 범위 밖 시간은 보정하지 않고 거절한다", () => {
  for (const seconds of [0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    const original = catalog("course", [{ id: "lesson", sequence: 1, lessonType: "lecture", seconds }]);
    assert.ok(issueCodes(normalizeLearningPlanCatalogs([{ subjectCode: "subject", catalog: original }], ["lecture"]))
      .includes("INVALID_DURATION_SECONDS"));
  }
});

test("서로 다른 강좌에 같은 원본 강의 ID가 있으면 전체 선택을 거절한다", () => {
  const result = normalizeLearningPlanCatalogs([
    { subjectCode: "one", catalog: catalog("course-one", [{ id: "shared", sequence: 1, lessonType: "lecture", seconds: 60 }]) },
    { subjectCode: "two", catalog: catalog("course-two", [{ id: "shared", sequence: 1, lessonType: "lecture", seconds: 60 }]) },
  ], ["lecture"]);
  assert.ok(issueCodes(result).includes("DUPLICATE_LESSON_ID"));
});

test("잘못된 원본 순서와 안전 범위를 넘는 카탈로그 총시간을 거절한다", () => {
  for (const sequence of [-1, 0.5, Number.NaN]) {
    const value = catalog("course", [{ id: "lesson", sequence, lessonType: "lecture", seconds: 60 }]);
    assert.ok(issueCodes(normalizeLearningPlanCatalogs([{ subjectCode: "subject", catalog: value }], ["lecture"]))
      .includes("INVALID_SEQUENCE"));
  }
  const huge = catalog("course", [
    { id: "one", sequence: 1, lessonType: "lecture", seconds: Number.MAX_SAFE_INTEGER },
    { id: "two", sequence: 2, lessonType: "lecture", seconds: 1 },
  ]);
  assert.ok(issueCodes(normalizeLearningPlanCatalogs([{ subjectCode: "subject", catalog: huge }], ["lecture"]))
    .includes("UNSAFE_DURATION_TOTAL"));
});

test("알 수 없는 강의 유형·없는 편성 대상·명시하지 않은 포함 유형은 거절한다", () => {
  const original = catalog("course", [{ id: "ot", sequence: 1, lessonType: "orientation", seconds: 193 }]);
  assert.ok(issueCodes(normalizeLearningPlanCatalogs([{ subjectCode: "subject", catalog: original }], ["lecture"]))
    .includes("NO_PLANNABLE_LESSONS"));
  assert.ok(issueCodes(normalizeLearningPlanCatalogs([{ subjectCode: "subject", catalog: original }], []))
    .includes("INVALID_LESSON_TYPE_SELECTION"));
  original.lessons[0].lessonType = "unknown" as CourseCatalogLesson["lessonType"];
  assert.ok(issueCodes(normalizeLearningPlanCatalogs([{ subjectCode: "subject", catalog: original }], ["lecture"]))
    .includes("UNSUPPORTED_LESSON_TYPE"));
});

test("일정 검증은 여러 과목의 실제 초를 합산하고 입력·출력 배열을 변경하지 않는다", () => {
  const value = input();
  const before = structuredClone(value);
  assert.deepEqual(validateLearningPlan(value), { kind: "valid", assignmentCount: 3, totalDurationSeconds: 2402,
    days: [{ date: "2026-10-01", capacitySeconds: 1801, scheduledSeconds: 1801 },
      { date: "2026-10-02", capacitySeconds: 601, scheduledSeconds: 601 }] });
  assert.deepEqual(value, before);
  assert.equal(validateLearningPlan({ ...value, assignments: [...value.assignments].reverse() }).kind, "valid");
});

test("강의 누락·중복·카탈로그 밖의 항목을 각각 거절한다", () => {
  const value = input();
  assert.ok(issueCodes(validateLearningPlan({ ...value, assignments: value.assignments.slice(0, 2) })).includes("MISSING_ASSIGNMENT"));
  assert.ok(issueCodes(validateLearningPlan({ ...value, assignments: [...value.assignments, value.assignments[0]] })).includes("DUPLICATE_ASSIGNMENT"));
  assert.ok(issueCodes(validateLearningPlan({ ...value, assignments: [...value.assignments,
    { ...value.assignments[0], lessonId: "invented", order: 2 }] })).includes("UNKNOWN_LESSON"));
});

test("출력의 강의 시간을 줄여도 실제 초 기준 시간 초과를 숨길 수 없다", () => {
  const value = input();
  const result = validateLearningPlan({ ...value,
    days: [{ date: "2026-10-01", capacitySeconds: 1800 }, value.days[1]],
    assignments: [{ ...value.assignments[0], durationSeconds: 1200 }, ...value.assignments.slice(1)] });
  const codes = issueCodes(result);
  assert.ok(codes.includes("ASSIGNMENT_DURATION_MISMATCH"));
  assert.ok(codes.includes("DAY_CAPACITY_EXCEEDED"));
  if (result.kind === "invalid") assert.equal(result.issues.find((issue) => issue.code === "DAY_CAPACITY_EXCEEDED")?.actualSeconds, 1801);
});

test("과목·강좌를 바꾸거나 날짜별 공통 한도를 초과하는 배정은 거절한다", () => {
  const value = input();
  assert.ok(issueCodes(validateLearningPlan({ ...value,
    assignments: [{ ...value.assignments[0], subjectCode: "korean", courseId: "korean-course" }, ...value.assignments.slice(1)] }))
    .includes("ASSIGNMENT_IDENTITY_MISMATCH"));
  assert.ok(issueCodes(validateLearningPlan({ ...value,
    days: [{ ...value.days[0], capacitySeconds: 1201 }, value.days[1]] })).includes("DAY_CAPACITY_EXCEEDED"));
});

test("강좌 순서는 날짜 순서와 같은 날짜의 항목 순서 모두에서 검사한다", () => {
  const value = input();
  assert.ok(issueCodes(validateLearningPlan({ ...value,
    days: [{ ...value.days[0], capacitySeconds: 3000 }, { ...value.days[1], capacitySeconds: 3000 }],
    assignments: [{ ...value.assignments[0], date: "2026-10-02" }, value.assignments[1],
      { ...value.assignments[2], date: "2026-10-01", order: 2 }] })).includes("COURSE_ORDER_VIOLATION"));
  assert.ok(issueCodes(validateLearningPlan({ ...value,
    days: [{ ...value.days[0], capacitySeconds: 3000 }, value.days[1]],
    assignments: [{ ...value.assignments[0], order: 2 }, value.assignments[1],
      { ...value.assignments[2], date: "2026-10-01", order: 0 }] })).includes("COURSE_ORDER_VIOLATION"));
});

test("허용하지 않은 날짜와 같은 날짜 순서 중복·잘못된 순서를 거절한다", () => {
  const value = input();
  for (const [change, code] of [
    [{ date: "2026-10-03" }, "UNKNOWN_DATE"], [{ order: -1 }, "INVALID_ASSIGNMENT_ORDER"],
    [{ order: 1 }, "DUPLICATE_DATE_ORDER"],
  ] as const) {
    assert.ok(issueCodes(validateLearningPlan({ ...value,
      assignments: [{ ...value.assignments[0], ...change }, ...value.assignments.slice(1)] })).includes(code));
  }
});

test("완료 항목은 누락으로 세지 않으며 다시 배정하면 거절한다", () => {
  const value = input();
  const completedLessonIds = ["math:1", "archived-course:old-lesson"];
  const result = validateLearningPlan({ ...value, completedLessonIds, assignments: value.assignments.slice(1) });
  assert.equal(result.kind, "valid");
  if (result.kind === "valid") assert.equal(result.totalDurationSeconds, 1201);
  assert.ok(issueCodes(validateLearningPlan({ ...value, completedLessonIds })).includes("COMPLETED_LESSON_SCHEDULED"));
});

test("완료만 남은 계획과 가용 시간 0인 날짜는 빈 일정으로 검증할 수 있다", () => {
  const value = input();
  const result = validateLearningPlan({ ...value, assignments: [],
    completedLessonIds: ["math:1", "math:2", "korean:1"], days: [{ date: "2026-10-01", capacitySeconds: 0 }] });
  assert.deepEqual(result, { kind: "valid", assignmentCount: 0, totalDurationSeconds: 0,
    days: [{ date: "2026-10-01", capacitySeconds: 0, scheduledSeconds: 0 }] });
});

test("잘못된 검증 기준과 중복 날짜·완료 ID는 일정 검증 전 명시적으로 거절한다", () => {
  const value = input();
  assert.ok(issueCodes(validateLearningPlan({ ...value, items: [...value.items, value.items[0]] })).includes("DUPLICATE_LESSON_ID"));
  assert.ok(issueCodes(validateLearningPlan({ ...value, days: [...value.days, value.days[0]] })).includes("DUPLICATE_DAY"));
  assert.ok(issueCodes(validateLearningPlan({ ...value, completedLessonIds: ["math:1", "math:1"] })).includes("DUPLICATE_COMPLETED_LESSON_ID"));
  assert.ok(issueCodes(validateLearningPlan({ ...value, days: [{ ...value.days[0], capacitySeconds: -1 }] })).includes("INVALID_CAPACITY_SECONDS"));
});

test("안전한 정수 범위 밖의 합계는 유효한 일정으로 반환하지 않는다", () => {
  const value = input();
  const result = validateLearningPlan({ ...value,
    items: value.items.map((item) => ({ ...item, durationSeconds: Number.MAX_SAFE_INTEGER })),
    days: value.days.map((day) => ({ ...day, capacitySeconds: Number.MAX_SAFE_INTEGER })),
    assignments: value.assignments.map((assignment) => ({ ...assignment, durationSeconds: Number.MAX_SAFE_INTEGER })) });
  assert.ok(issueCodes(result).includes("UNSAFE_DURATION_TOTAL"));
});
