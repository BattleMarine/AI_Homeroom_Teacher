import { createFileCourseCatalogRepository } from "../course-catalog/course-catalog.file-repository.js";
import type { PoolClient } from "pg";
import type { CourseCatalog } from "../course-catalog/course-catalog.types.js";
import { getDatabaseConfig } from "../config.js";
import { createPostgresStudentCurriculumRepository } from "../student-curriculum/student-curriculum.postgres-repository.js";
import { seedDemoStudentCurricula } from "../student-curriculum/student-curriculum.seed.js";
import { createDatabaseClient } from "./client.js";

const database = createDatabaseClient(getDatabaseConfig().connectionString);

try {
  const courseCatalogRepository = createFileCourseCatalogRepository();
  const courses = await courseCatalogRepository.listCourses();
  const catalogs = (await Promise.all(courses.map(({ id }) => courseCatalogRepository.getCourseCatalog(id))))
    .filter((catalog): catalog is CourseCatalog => catalog !== undefined);
  const defaultCatalog = await courseCatalogRepository.getDefaultCourseCatalog();
  const now = new Date();

  await database.withTransaction(async (client) => {
    await client.query(
      `INSERT INTO students (id, display_name, status, created_at, updated_at)
       VALUES ($1, $2, 'demo', $3, $3)
       ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, status = EXCLUDED.status, updated_at = EXCLUDED.updated_at`,
      ["000", "데모 학생", now],
    );

    for (const catalog of catalogs) {
      await upsertCourseCatalog(client, catalog, now);
    }
  });

  await seedDemoStudentCurricula(createPostgresStudentCurriculumRepository(database.pool), defaultCatalog);
  const lessonCount = catalogs.reduce((total, catalog) => total + catalog.lessons.length, 0);
  console.log(`기준 학생과 강좌 ${catalogs.length}개, 강의 ${lessonCount}개, 후보 커리큘럼 3개를 적재했습니다.`);
} finally {
  await database.close();
}

async function upsertCourseCatalog(
  client: PoolClient,
  catalog: CourseCatalog,
  now: Date,
) {
  await client.query(
    `INSERT INTO courses (
      id, provider_id, provider_name, instructor_id, instructor_name, title, primary_subject,
      included_subjects, curriculum_year, lesson_count, orientation_count, content_lesson_count,
      total_duration_seconds, source_url, status, created_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16)
    ON CONFLICT (id) DO UPDATE SET
      provider_id=EXCLUDED.provider_id, provider_name=EXCLUDED.provider_name,
      instructor_id=EXCLUDED.instructor_id, instructor_name=EXCLUDED.instructor_name,
      title=EXCLUDED.title, primary_subject=EXCLUDED.primary_subject, included_subjects=EXCLUDED.included_subjects,
      curriculum_year=EXCLUDED.curriculum_year, lesson_count=EXCLUDED.lesson_count,
      orientation_count=EXCLUDED.orientation_count, content_lesson_count=EXCLUDED.content_lesson_count,
      total_duration_seconds=EXCLUDED.total_duration_seconds, source_url=EXCLUDED.source_url,
      status=EXCLUDED.status, updated_at=EXCLUDED.updated_at`,
    [
      catalog.course.id, catalog.course.provider.id, catalog.course.provider.name, catalog.course.instructor.id,
      catalog.course.instructor.name, catalog.course.title, catalog.course.primarySubject,
      JSON.stringify(catalog.course.includedSubjects), catalog.course.curriculumYear, catalog.course.lessonCount,
      catalog.course.orientationCount, catalog.course.contentLessonCount, catalog.course.totalDurationSeconds,
      catalog.course.sourceUrl, catalog.course.status, now,
    ],
  );

  for (const lesson of catalog.lessons) {
    await client.query(
      `INSERT INTO lessons (
        id, course_id, sequence, lecture_number, title, lesson_type, subject_areas, unit_names,
        duration_display, duration_seconds, source_url, playback_target_id, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)
      ON CONFLICT (id) DO UPDATE SET
        course_id=EXCLUDED.course_id, sequence=EXCLUDED.sequence, lecture_number=EXCLUDED.lecture_number,
        title=EXCLUDED.title, lesson_type=EXCLUDED.lesson_type, subject_areas=EXCLUDED.subject_areas,
        unit_names=EXCLUDED.unit_names, duration_display=EXCLUDED.duration_display,
        duration_seconds=EXCLUDED.duration_seconds, source_url=EXCLUDED.source_url,
        playback_target_id=EXCLUDED.playback_target_id, updated_at=EXCLUDED.updated_at`,
      [lesson.id, lesson.courseId, lesson.sequence, lesson.lectureNumber, lesson.title, lesson.lessonType,
        JSON.stringify(lesson.subjectAreas), JSON.stringify(lesson.unitNames), lesson.duration.display,
        lesson.duration.seconds, lesson.sourceUrl, lesson.playbackTargetId ?? `mock-video:${lesson.id}`, now],
    );
  }

  const actual = await client.query(
    "SELECT count(*)::text AS count, coalesce(sum(duration_seconds), 0)::text AS total FROM lessons WHERE course_id = $1",
    [catalog.course.id],
  );
  if (Number(actual.rows[0].count) !== catalog.lessons.length || Number(actual.rows[0].total) !== catalog.course.totalDurationSeconds) {
    throw new Error("강좌 카탈로그 seed 검증에 실패했습니다.");
  }
}
