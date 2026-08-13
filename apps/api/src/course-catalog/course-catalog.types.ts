export type CourseCatalogCourse = {
  id: string;
  provider: { id: string; name: string };
  instructor: { id: string; name: string };
  title: string;
  primarySubject: string;
  includedSubjects: string[];
  curriculumYear: number;
  lessonCount: number;
  orientationCount: number;
  contentLessonCount: number;
  totalDurationSeconds: number;
  sourceUrl: string | null;
  status: "metadata_only";
};

export type CourseCatalogLesson = {
  id: string;
  courseId: string;
  sequence: number;
  lectureNumber: number | null;
  title: string;
  lessonType: "orientation" | "lecture" | "mock_exam";
  subjectAreas: string[];
  unitNames: string[];
  duration: { display: string; seconds: number };
  sourceUrl: string | null;
  playbackTargetId: string | null;
};

export type CourseCatalog = {
  course: CourseCatalogCourse;
  lessons: CourseCatalogLesson[];
};

export type CourseCatalogRepository = {
  listCourses(): Promise<CourseCatalogCourse[]>;
  getCourseCatalog(courseId: string): Promise<CourseCatalog | undefined>;
  getDefaultCourseCatalog(): Promise<CourseCatalog>;
};
