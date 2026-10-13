import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";

/** 로컬 환경값을 출력하지 않고 새 전체 계획 전용 DB인지 확인한다. */
export async function openLearningPlanTestPool(): Promise<Pool> {
  assert.equal(process.env.VERIFY_TOOLS_ALLOW_TEST_DATABASE, "1", "전용 DB 검증의 명시 허용이 필요합니다.");
  const value = process.env.TEST_DATABASE_URL;
  assert.ok(value, "TEST_DATABASE_URL이 필요합니다.");
  const parsed = new URL(value);
  assert.match(parsed.pathname, /^\/test_learning_plan_[a-f0-9]{32}$/);
  const pool = new Pool({ connectionString: value });
  try {
    const actual = await pool.query<{ name: string }>("SELECT current_database() AS name");
    assert.equal(actual.rows[0].name, parsed.pathname.slice(1));
    return pool;
  } catch {
    await pool.end();
    throw new Error("전용 DB 연결 또는 대상 확인에 실패했습니다. 로컬 환경 파일과 DB 상태를 확인하세요.");
  }
}

export type LearningPlanHttpServer = {
  pid: number;
  /** 임시 프록시 연결에만 사용하며 로그·보고서에 출력하지 않는다. */
  origin: string;
  request<T>(path: string, body?: unknown, expectedStatus?: number, timeoutMs?: number): Promise<T>;
  stop(): Promise<void>;
};

/** 앱 객체 재생성 대신 실제 서버 OS 프로세스를 실행한다. 접속 주소와 서버 로그는 출력하지 않는다. */
export async function startLearningPlanHttpServer(options: { port?: number } = {}): Promise<LearningPlanHttpServer> {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  assert.ok(databaseUrl, "TEST_DATABASE_URL이 필요합니다.");
  assert.equal(process.env.VERIFY_TOOLS_ALLOW_TEST_DATABASE, "1");
  assert.match(new URL(databaseUrl).pathname, /^\/test_learning_plan_[a-f0-9]{32}$/);
  const port = options.port ?? await availablePort();
  assert.ok(Number.isSafeInteger(port) && port > 0 && port <= 65535);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
    env: { ...process.env, DATABASE_URL: databaseUrl, PERSISTENCE_MODE: "postgres", API_HOST: "127.0.0.1", API_PORT: String(port) },
    windowsHide: true,
    stdio: "ignore",
  });
  let launchError: Error | undefined;
  child.on("error", (error) => { launchError = error; });
  const stop = () => stopProcess(child);
  try {
    const deadline = Date.now() + 20_000;
    let ready = false;
    while (Date.now() < deadline) {
      if (launchError || child.exitCode !== null || child.signalCode !== null) {
        throw new Error("검증용 서버 프로세스가 시작에 실패했습니다. DB 연결과 migration을 확인하세요.");
      }
      try {
        const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(500) });
        if (response.ok) { ready = true; break; }
      } catch { /* 프로세스 준비까지 제한된 시간 동안 기다린다. */ }
      await delay(100);
    }
    assert.ok(ready, "검증용 서버 준비 제한 시간을 넘었습니다.");
    assert.ok(child.pid);
    return {
      pid: child.pid,
      origin: baseUrl,
      async request<T>(path: string, body?: unknown, expectedStatus = 200, timeoutMs = 15_000): Promise<T> {
        assert.ok(path.startsWith("/api/"), "검증은 해당 서버의 API만 호출합니다.");
        const response = await fetch(`${baseUrl}${path}`, {
          method: body === undefined ? "GET" : "POST",
          headers: body === undefined ? undefined : { "content-type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
        const payload = await response.json() as T;
        const code = payload && typeof payload === "object" ? (payload as { code?: unknown }).code : undefined;
        assert.equal(response.status, expectedStatus, `${path.split("?")[0]} HTTP 상태가 예상과 다릅니다.${typeof code === "string" ? ` 오류 코드: ${code}` : ""}`);
        return payload;
      },
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}

async function availablePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const address = probe.address();
  assert.ok(address && typeof address === "object");
  await new Promise<void>((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("검증용 서버 프로세스 종료 확인에 실패했습니다.")), 5_000);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
    if (!child.kill()) { clearTimeout(timer); reject(new Error("검증용 서버 프로세스를 종료하지 못했습니다.")); }
  });
}
