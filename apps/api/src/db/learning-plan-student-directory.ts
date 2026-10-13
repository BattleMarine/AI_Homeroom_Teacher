import type { Pool, PoolClient } from "pg";
import { LearningPlanRepositoryError } from "../learning-plan/learning-plan.repository.js";

/** 인증이 아닌 로컬 개발용 대상 목록. 표시 이름·학습 내용은 반환하지 않는다. */
export type LearningPlanStudentTarget = { studentId: string; hasLearningPlan: boolean };
export type LearningPlanStudentDirectory = {
  listStudentTargets(): Promise<LearningPlanStudentTarget[]>;
  /** 활성·데모 학생만 허용하며 존재 검사로 학생/계획을 생성하지 않는다. */
  assertStudentExists(studentId: string): Promise<void>;
};

export function createPostgresLearningPlanStudentDirectory(pool: Pool): LearningPlanStudentDirectory {
  async function readOnly<T>(action: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const result = await action(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
  return {
    listStudentTargets() {
      return readOnly(async (client) => (await client.query<{ student_id: string; has_learning_plan: boolean }>(
        `SELECT s.id AS student_id,EXISTS (
          SELECT 1 FROM learning_plans p WHERE p.student_id=s.id AND p.current_version_id IS NOT NULL
        ) AS has_learning_plan FROM students s WHERE s.status IN ('active','demo') ORDER BY s.id COLLATE "C"`,
      )).rows.map((row) => ({ studentId: row.student_id, hasLearningPlan: row.has_learning_plan })));
    },
    async assertStudentExists(studentId) {
      if (typeof studentId !== "string" || !studentId || studentId !== studentId.trim() || studentId.length > 100) {
        throw new LearningPlanRepositoryError("INVALID_CANDIDATE", "학생 식별자가 유효하지 않습니다.");
      }
      await readOnly(async (client) => {
        const found = await client.query("SELECT id FROM students WHERE id=$1 AND status IN ('active','demo')", [studentId]);
        if (!found.rowCount) throw new LearningPlanRepositoryError("NOT_FOUND", "활성 또는 데모 학생을 찾을 수 없습니다.");
      });
    },
  };
}
