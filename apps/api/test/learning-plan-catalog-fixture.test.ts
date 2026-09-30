import assert from "node:assert/strict";
import test from "node:test";
import { createFileCourseCatalogRepository } from "../src/course-catalog/course-catalog.file-repository.js";
import { assertDedicatedTestDatabaseName, summarizeLearningPlanCatalog } from "./helpers/learning-plan-catalog-fixture.js";

test("전용 DB 이름과 명시적 허용을 모두 요구한다", () => {
  assert.doesNotThrow(() => assertDedicatedTestDatabaseName("test_learning_plan_ab123", true));
  for (const name of ["development", "postgres", "production_test", "test_", 'test_x";', "test_X"]) {
    assert.throws(() => assertDedicatedTestDatabaseName(name, true));
  }
  assert.throws(() => assertDedicatedTestDatabaseName("test_learning_plan_ab123", false));
});

test("원본 보고는 실제 강의 수와 초를 사용하고 오리엔테이션만 별도 표시한다", async () => {
  const repository = createFileCourseCatalogRepository();
  let totalRows = 0;
  let totalContent = 0;
  let totalSeconds = 0;
  for (const course of await repository.listCourses()) {
    const catalog = await repository.getCourseCatalog(course.id);
    assert.ok(catalog);
    const report = summarizeLearningPlanCatalog(catalog);
    assert.equal(report.lessonCount, catalog.lessons.length);
    assert.equal(report.excludedOrientations.length, 1);
    assert.equal(report.contentCount, catalog.lessons.length - 1);
    assert.match(report.manifestSha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(summarizeLearningPlanCatalog({ ...catalog, lessons: [...catalog.lessons].reverse() }), report);
    totalRows += report.lessonCount;
    totalContent += report.contentCount;
    totalSeconds += report.contentDurationSeconds;
  }
  // 감사한 현재 카탈로그의 회귀 기준이며 제품의 고정 수량 규칙이 아니다.
  assert.deepEqual([totalRows, totalContent, totalSeconds], [129, 126, 419939]);
});
