import type { Pool } from "pg";

export type Student = {
  id: string;
  displayName: string | null;
  status: "active" | "inactive" | "demo";
};

export type StudentRepository = {
  getById(studentId: string): Promise<Student | undefined>;
  ensureDemoStudent(studentId: string, displayName?: string): Promise<Student>;
};

export function createPostgresStudentRepository(pool: Pool): StudentRepository {
  return {
    async getById(studentId) {
      const result = await pool.query<StudentRow>(
        "SELECT id, display_name, status FROM students WHERE id = $1",
        [studentId],
      );
      return result.rows[0] ? mapStudent(result.rows[0]) : undefined;
    },
    async ensureDemoStudent(studentId, displayName = "데모 학생") {
      const result = await pool.query<StudentRow>(
        `INSERT INTO students (id, display_name, status, created_at, updated_at)
         VALUES ($1, $2, 'demo', now(), now())
         ON CONFLICT (id) DO UPDATE SET updated_at = now()
         RETURNING id, display_name, status`,
        [studentId, displayName],
      );
      return mapStudent(result.rows[0]);
    },
  };
}

type StudentRow = { id: string; display_name: string | null; status: Student["status"] };

function mapStudent(row: StudentRow): Student {
  return { id: row.id, displayName: row.display_name, status: row.status };
}
