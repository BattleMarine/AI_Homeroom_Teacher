import type { Pool } from "pg";
import type { CourseCatalog, CourseCatalogCourse, CourseCatalogLesson, CourseCatalogRepository } from "./course-catalog.types.js";

const defaultCourseCatalogId = "ebsi-2026-suneungwanseong-namchiyeol-math-calculus-all";

export function createPostgresCourseCatalogRepository(pool: Pool): CourseCatalogRepository {
  return {
    async listCourses() {
      const result = await pool.query<CourseRow>("SELECT * FROM courses ORDER BY title ASC");
      return result.rows.map(mapCourse);
    },
    async getCourseCatalog(courseId) {
      const courseResult = await pool.query<CourseRow>("SELECT * FROM courses WHERE id = $1", [courseId]);
      const course = courseResult.rows[0];
      if (!course) return undefined;
      const lessons = await pool.query<LessonRow>("SELECT * FROM lessons WHERE course_id = $1 ORDER BY sequence ASC", [courseId]);
      return { course: mapCourse(course), lessons: lessons.rows.map(mapLesson) };
    },
    async getDefaultCourseCatalog() {
      const courseResult = await pool.query<CourseRow>("SELECT * FROM courses WHERE id = $1", [defaultCourseCatalogId]);
      const course = courseResult.rows[0];
      if (!course) throw new Error("기준 강좌 카탈로그가 PostgreSQL에 없습니다. db:seed를 먼저 실행하세요.");
      const lessons = await pool.query<LessonRow>("SELECT * FROM lessons WHERE course_id = $1 ORDER BY sequence ASC", [course.id]);
      return { course: mapCourse(course), lessons: lessons.rows.map(mapLesson) };
    },
  };
}

type CourseRow = {
  id: string; provider_id: string; provider_name: string; instructor_id: string; instructor_name: string;
  title: string; primary_subject: string; included_subjects: string[]; curriculum_year: number;
  lesson_count: number; orientation_count: number; content_lesson_count: number; total_duration_seconds: number;
  source_url: string | null; status: "metadata_only";
};

type LessonRow = {
  id: string; course_id: string; sequence: number; lecture_number: number | null; title: string;
  lesson_type: "orientation" | "lecture" | "mock_exam"; subject_areas: string[]; unit_names: string[];
  duration_display: string; duration_seconds: number; source_url: string | null; playback_target_id: string | null;
};

function mapCourse(row: CourseRow): CourseCatalogCourse {
  return {
    id: row.id,
    provider: { id: row.provider_id, name: row.provider_name },
    instructor: { id: row.instructor_id, name: row.instructor_name },
    title: row.title,
    primarySubject: row.primary_subject,
    includedSubjects: row.included_subjects,
    curriculumYear: row.curriculum_year,
    lessonCount: row.lesson_count,
    orientationCount: row.orientation_count,
    contentLessonCount: row.content_lesson_count,
    totalDurationSeconds: row.total_duration_seconds,
    sourceUrl: row.source_url,
    status: row.status,
  };
}

function mapLesson(row: LessonRow): CourseCatalogLesson {
  return {
    id: row.id, courseId: row.course_id, sequence: row.sequence, lectureNumber: row.lecture_number,
    title: row.title, lessonType: row.lesson_type, subjectAreas: row.subject_areas, unitNames: row.unit_names,
    duration: { display: row.duration_display, seconds: row.duration_seconds },
    sourceUrl: row.source_url, playbackTargetId: row.playback_target_id,
  };
}
