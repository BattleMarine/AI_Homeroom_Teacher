import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import type { DatabaseClient } from "../../src/db/client.js";
import { courses, lessons } from "../../src/db/schema.js";
import { createFileCourseCatalogRepository } from "../../src/course-catalog/course-catalog.file-repository.js";
import { createPostgresCourseCatalogRepository } from "../../src/course-catalog/course-catalog.postgres-repository.js";
import type { CourseCatalog } from "../../src/course-catalog/course-catalog.types.js";

export function assertDedicatedTestDatabaseName(name: string, allow: boolean): void {
  if (!allow || !/^test_[a-z0-9_]+$/.test(name)) {
    throw new Error("명시적으로 허용한 test_ 전용 DB에서만 fixture를 준비할 수 있습니다.");
  }
}

/** 학생·계획을 생성하지 않고, 비어 있는 전용 DB에 카탈로그만 적재한다. */
export async function prepareLearningPlanCatalogFixture(database: DatabaseClient, allow: boolean) {
  const source = createFileCourseCatalogRepository();
  const catalogs: CourseCatalog[] = [];
  for (const course of await source.listCourses()) {
    const catalog = await source.getCourseCatalog(course.id);
    assert.ok(catalog, "원본 강좌를 찾을 수 없습니다.");
    catalogs.push(catalog);
  }

  await database.withTransaction(async (client) => {
    const identity = await client.query<{ name: string }>("SELECT current_database() AS name");
    assertDedicatedTestDatabaseName(identity.rows[0].name, allow);
    // 동시 fixture 준비도 빈 상태 확인부터 함께 직렬화한다.
    await client.query("LOCK TABLE courses, lessons, students IN ACCESS EXCLUSIVE MODE");
    const counts = await client.query<{ empty: boolean }>(
      `SELECT NOT EXISTS (SELECT 1 FROM courses)
        AND NOT EXISTS (SELECT 1 FROM lessons)
        AND NOT EXISTS (SELECT 1 FROM students) AS empty`,
    );
    assert.equal(counts.rows[0].empty, true, "기존 데이터가 있는 DB에는 fixture를 적재하지 않습니다.");
    const db = drizzle({ client });
    const now = new Date();
    for (const { course, lessons: catalogLessons } of catalogs) {
      await db.insert(courses).values({
        id: course.id, providerId: course.provider.id, providerName: course.provider.name,
        instructorId: course.instructor.id, instructorName: course.instructor.name,
        title: course.title, primarySubject: course.primarySubject,
        includedSubjects: course.includedSubjects, curriculumYear: course.curriculumYear,
        lessonCount: course.lessonCount, orientationCount: course.orientationCount,
        contentLessonCount: course.contentLessonCount, totalDurationSeconds: course.totalDurationSeconds,
        sourceUrl: course.sourceUrl, status: course.status, createdAt: now, updatedAt: now,
      });
      if (catalogLessons.length > 0) {
        await db.insert(lessons).values(catalogLessons.map((lesson) => ({
          id: lesson.id, courseId: lesson.courseId, sequence: lesson.sequence,
          lectureNumber: lesson.lectureNumber, title: lesson.title, lessonType: lesson.lessonType,
          subjectAreas: lesson.subjectAreas, unitNames: lesson.unitNames,
          durationDisplay: lesson.duration.display, durationSeconds: lesson.duration.seconds,
          sourceUrl: lesson.sourceUrl, playbackTargetId: lesson.playbackTargetId,
          createdAt: now, updatedAt: now,
        })));
      }
    }
  });

  const repository = createPostgresCourseCatalogRepository(database.pool);
  const actualCourses = await repository.listCourses();
  assert.equal(actualCourses.length, catalogs.length);
  const report = [];
  for (const expected of catalogs) {
    const actual = await repository.getCourseCatalog(expected.course.id);
    assert.deepEqual(actual, expected, "DB 재조회와 카탈로그 원본이 일치하지 않습니다.");
    assert.ok(actual);
    report.push(summarizeLearningPlanCatalog(actual));
  }
  return report;
}

/** 제외 기준은 준비 보고용이며 제품 편성 정책을 설정하지 않는다. */
export function summarizeLearningPlanCatalog(catalog: CourseCatalog) {
  const ordered = [...catalog.lessons].sort((a, b) => a.sequence - b.sequence);
  const content = ordered.filter((lesson) => lesson.lessonType !== "orientation");
  const manifest = ordered.map(({ id, sequence, lectureNumber, lessonType, duration }) => ({
    id, sequence, lectureNumber, lessonType, durationSeconds: duration.seconds,
  }));
  return {
    courseId: catalog.course.id,
    lessonCount: ordered.length,
    excludedOrientations: ordered.filter((lesson) => lesson.lessonType === "orientation").map(({ id }) => id),
    contentCount: content.length,
    contentDurationSeconds: content.reduce((sum, lesson) => sum + lesson.duration.seconds, 0),
    manifestSha256: createHash("sha256").update(JSON.stringify(manifest)).digest("hex"),
  };
}
