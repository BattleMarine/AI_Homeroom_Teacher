import { readFileSync } from "node:fs";
import type {
  CourseCatalog,
  CourseCatalogCourse,
  CourseCatalogLesson,
  CourseCatalogRepository,
} from "./course-catalog.types.js";

const defaultCourseCatalogId = "ebsi-2026-suneungwanseong-namchiyeol-math-calculus-all";
const courseCatalogFileUrls = [
  new URL(
    "../../../../data/course-catalog/ebsi-2026-suneungwanseong-namchiyeol-math-calculus.json",
    import.meta.url,
  ),
  new URL(
    "../../../../data/course-catalog/ebsi-2027-suneungwanseong-choeseohee-korean-language-media.json",
    import.meta.url,
  ),
  new URL(
    "../../../../data/course-catalog/ebsi-2027-suneungwanseong-kimjehee-english.json",
    import.meta.url,
  ),
];

export function createFileCourseCatalogRepository(): CourseCatalogRepository {
  const catalogs = courseCatalogFileUrls.map(readCourseCatalogFile);
  const defaultCatalog = catalogs.find((catalog) => catalog.course.id === defaultCourseCatalogId);

  if (!defaultCatalog) {
    throw new Error("기준 강좌 카탈로그 파일을 찾을 수 없습니다.");
  }

  return {
    async listCourses() {
      return catalogs.map((catalog) => catalog.course);
    },

    async getCourseCatalog(courseId) {
      return catalogs.find((catalog) => catalog.course.id === courseId);
    },

    async getDefaultCourseCatalog() {
      return defaultCatalog;
    },
  };
}

function readCourseCatalogFile(courseCatalogFileUrl: URL): CourseCatalog {
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
