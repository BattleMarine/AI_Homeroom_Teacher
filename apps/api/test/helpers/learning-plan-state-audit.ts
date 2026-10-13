import type { Pool } from "pg";

/** 제안 행을 제외한 학생의 학습 상태를 독립 SQL로 읽는다. LLM 입력이 아닌 검사 전용이다. */
export async function readLearningPlanStateAudit(pool: Pool, studentId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const plans = (await client.query("SELECT * FROM learning_plans WHERE student_id=$1 ORDER BY id", [studentId])).rows;
    const planIds = plans.map(({ id }) => id as string);
    const rows: Record<string, unknown[]> = { learning_plans: plans };
    for (const table of ["learning_plan_versions", "learning_plan_items", "learning_plan_assignments",
      "learning_plan_completions", "learning_plan_completion_keys", "learning_plan_feedbacks", "learning_plan_progress_events"]) {
      // 테이블명은 위 고정 목록이며 호출자가 SQL 식별자를 전달하지 않는다.
      rows[table] = (await client.query(`SELECT row_to_json(t) AS row FROM ${table} t
        WHERE plan_id=ANY($1::varchar[]) ORDER BY to_jsonb(t)::text COLLATE "C"`, [planIds])).rows.map(({ row }) => row);
    }
    await client.query("COMMIT");
    return rows;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
