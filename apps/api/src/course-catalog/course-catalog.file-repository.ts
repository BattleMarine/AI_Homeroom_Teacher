import { readFileSync } from "node:fs";
import type {
  CourseCatalog,
  CourseCatalogCourse,
  CourseCatalogLesson,
  CourseCatalogRepository,
} from "./course-catalog.types.js";

const courseCatalogFileUrl = new URL(
  "../../../../data/course-catalog/ebsi-2026-suneungwanseong-namchiyeol-math-calculus.json",
  import.meta.url,
);

export function createFileCourseCatalogRepository(): CourseCatalogRepository {
  const catalog = readCourseCatalogFile();

  return {
    async listCourses() {
      return [catalog.course];
    },

    async getCourseCatalog(courseId) {
      return courseId === catalog.course.id ? catalog : undefined;
    },

    async getDefaultCourseCatalog() {
      return catalog;
    },
  };
}

function readCourseCatalogFile(): CourseCatalog {
  const parsedValue: unknown = JSON.parse(readFileSync(courseCatalogFileUrl, "utf8"));

  if (!isCourseCatalogDocument(parsedValue)) {
    throw new Error("강좌 카탈로그 파일 형식이 올바르지 않습니다.");
  }

  return parsedValue.data;
}

function isCourseCatalogDocument(value: unknown): value is { data: CourseCatalog } {
  if (!isRecord(value) || !isRecord(value.data)) return false;

  const { course, lessons } = value.data;

  return isCourse(course) && Array.isArray(lessons) && lessons.every(isLesson);
}

function isCourse(value: unknown): value is CourseCatalogCourse {
  return isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.primarySubject === "string" &&
    Array.isArray(value.includedSubjects) &&
    value.includedSubjects.every((subject) => typeof subject === "string");
}

function isLesson(value: unknown): value is CourseCatalogLesson {
  return isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.courseId === "string" &&
    typeof value.sequence === "number" &&
    typeof value.title === "string" &&
    typeof value.lessonType === "string" &&
    Array.isArray(value.subjectAreas) &&
    Array.isArray(value.unitNames) &&
    isRecord(value.duration) &&
    typeof value.duration.seconds === "number";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
