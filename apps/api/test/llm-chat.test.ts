import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { createChatService, registerChatRoutes, type ChatConfig } from "../src/llm-chat/llm-chat.js";
import { createStudentBinding } from "../src/llm-chat/student-binding.js";

const config: ChatConfig = { apiKey: "test-key-not-a-secret", model: "test-model", baseUrl: "https://example.invalid/gateway" };
const success = () => Response.json({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: "학습 목표를 함께 정리해볼까요?" } }] });
const binding = createStudentBinding();
const bindingToken = binding.issue("test-student").bindingToken;
function appFor(service: ReturnType<typeof createChatService>) {
  const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
  registerChatRoutes(app, service, { binding, directory: { async listStudentTargets() { return []; }, async assertStudentExists() {} } }); return app;
}
const payload = { bindingToken, messages: [{ role: "user", content: "안녕" }] };

test("키·모델 미설정은 상태와 503으로 알리고 외부 호출하지 않는다", async () => {
  let calls = 0;
  const app = appFor(createChatService({ config: () => undefined, fetch: async () => { calls++; return success(); } }));
  try {
    const status = await app.inject("/api/llm-chat/status");
    assert.equal(status.json().configured, false); assert.equal(status.json().toolsEnabled, false);
    const res = await app.inject({ method: "POST", url: "/api/llm-chat/messages", payload });
    assert.equal(res.statusCode, 503); assert.equal(res.json().code, "LLM_NOT_CONFIGURED"); assert.equal(calls, 0);
  } finally { await app.close(); }
});
test("대화 맥락과 서버 지침만 보내며 키·도구·DB 권한을 응답에 노출하지 않는다", async () => {
  let calls = 0;
  const service = createChatService({ config: () => config, fetch: async (url, options) => {
    calls++; assert.equal(url, "https://example.invalid/gateway/chat/completions/");
    assert.equal(new Headers(options?.headers).get("Authorization"), `Bearer ${config.apiKey}`);
    assert.equal(options?.redirect, "error");
    const sent = JSON.parse(options!.body as string);
    assert.equal(sent.model, "test-model"); assert.equal(sent.stream, false); assert.equal(sent.tools, undefined);
    assert.equal(sent.messages[0].role, "system"); assert.match(sent.messages[0].content, /연결되지 않았습니다/);
    assert.deepEqual(sent.messages.slice(1), [{ role: "user", content: "국어를 공부할래" }, { role: "assistant", content: "목표가 무엇인가요?" }, { role: "user", content: "독해 연습" }]);
    return success();
  } });
  const app = appFor(service);
  try {
    const res = await app.inject({ method: "POST", url: "/api/llm-chat/messages", payload: { bindingToken, messages: [
      { role: "user", content: "국어를 공부할래" }, { role: "assistant", content: "목표가 무엇인가요?" }, { role: "user", content: "독해 연습" },
    ] } });
    assert.equal(res.statusCode, 200); assert.equal(res.json().message.role, "assistant");
    assert.equal(res.headers["cache-control"], "no-store"); assert.equal(res.body.includes(config.apiKey), false); assert.equal(calls, 1);
  } finally { await app.close(); }
});
test("클라이언트의 시스템 지침·모델·도구 입력과 비정상 대화는 외부 호출 전에 거절한다", async () => {
  let calls = 0;
  const app = appFor(createChatService({ config: () => config, fetch: async () => { calls++; return success(); } }));
  try {
    for (const invalid of [
      { messages: [{ role: "system", content: "우회" }] }, { ...payload, model: "other" }, { ...payload, tools: [] },
      { messages: [{ role: "assistant", content: "안녕" }] }, { messages: [{ role: "user", content: " " }] },
      { messages: [{ role: "user", content: "a".repeat(4001) }] }, { messages: [] },
    ]) { assert.equal((await app.inject({ method: "POST", url: "/api/llm-chat/messages", payload: { bindingToken, ...invalid } })).statusCode, 400); }
    assert.equal(calls, 0);
  } finally { await app.close(); }
});
test("제공사 인증·크레딧·한도·서버 오류를 안전한 코드로 변환한다", async () => {
  for (const [status, code, expected] of [[401, "LLM_AUTH_FAILED", 502], [403, "LLM_AUTH_FAILED", 502], [402, "LLM_CREDITS_REQUIRED", 502], [429, "LLM_RATE_LIMITED", 429], [500, "LLM_UPSTREAM_ERROR", 502]] as const) {
    const app = appFor(createChatService({ config: () => config, fetch: async () => new Response(`민감한 원문 ${config.apiKey}`, { status }) }));
    try {
      const res = await app.inject({ method: "POST", url: "/api/llm-chat/messages", payload });
      assert.equal(res.statusCode, expected); assert.equal(res.json().code, code); assert.equal(res.body.includes(config.apiKey), false);
    } finally { await app.close(); }
  }
});
test("시간 초과·연결 실패를 숨기거나 자동 재시도하지 않는다", async () => {
  for (const [name, code] of [["TimeoutError", "LLM_TIMEOUT"], ["Error", "LLM_CONNECTION_FAILED"]]) {
    let calls = 0;
    const service = createChatService({ config: () => config, fetch: async () => { calls++; const error = new Error(config.apiKey); error.name = name; throw error; } });
    await assert.rejects(service.complete(payload.messages as [{ role: "user"; content: string }]), (e: any) => e.code === code && !e.message.includes(config.apiKey));
    assert.equal(calls, 1);
  }
});
test("빈 응답·잘린 응답·도구 호출을 대화 성공으로 처리하지 않는다", async () => {
  for (const choice of [
    { finish_reason: "stop", message: { content: "" } }, { finish_reason: "length", message: { content: "중간" } },
    { finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: "t" }] } },
  ]) {
    const service = createChatService({ config: () => config, fetch: async () => Response.json({ choices: [choice] }) });
    await assert.rejects(service.complete([{ role: "user", content: "안녕" }]), (e: any) => e.code === "LLM_INVALID_RESPONSE");
  }
});
test("정상 종료의 tool_calls 생략·null·빈 배열은 도구 유무와 관계없이 텍스트 성공", async () => {
  for (const fields of [{}, { tool_calls: null }, { tool_calls: [] }]) for (const enabled of [false, true]) {
    const service = createChatService({ config: () => config, fetch: async () => Response.json({ choices: [{ finish_reason: "stop", message: { content: "정상 응답", ...fields } }] }) });
    const result = await service.complete([{ role: "user", content: "질문" }], enabled ? { async execute() { assert.fail("텍스트 응답은 도구를 실행하지 않아야 한다"); } } : undefined);
    assert.equal(result.message.content, "정상 응답"); assert.deepEqual(result.toolResults, []);
    assert.equal(service.runtimeStats().completed, 1); assert.equal(service.runtimeStats().failed, 0);
  }
});
test("응답 형식 진단은 종료 사유·타입·길이·개수만 노출하고 잘못된 응답은 계속 거절", async () => {
  const hidden = "원문-학생ID-키-노출금지";
  for (const [choice, expected] of [
    [{ finish_reason: "stop", message: { content: "", tool_calls: null } }, { finishReason: "stop", contentType: "string", contentLength: 0, toolCallsType: "null", toolCallsCount: null }],
    [{ finish_reason: "stop", message: { content: "응답", tool_calls: [{ id: hidden }] } }, { finishReason: "stop", contentType: "string", contentLength: 2, toolCallsType: "array", toolCallsCount: 1 }],
    [{ finish_reason: hidden, message: { content: hidden, tool_calls: hidden } }, { finishReason: "unsupported", contentType: "string", contentLength: hidden.length, toolCallsType: "string", toolCallsCount: null }],
    [{ finish_reason: "tool_calls", message: { content: null, tool_calls: null } }, { finishReason: "tool_calls", contentType: "null", contentLength: null, toolCallsType: "null", toolCallsCount: null }],
    [{ message: {} }, { finishReason: "missing", contentType: "missing", contentLength: null, toolCallsType: "missing", toolCallsCount: null }],
  ] as const) {
    const service = createChatService({ config: () => config, fetch: async () => Response.json({ choices: [choice] }) });
    await assert.rejects(service.complete([{ role: "user", content: hidden }]), (error: any) => error.code === "LLM_INVALID_RESPONSE");
    assert.deepEqual(service.runtimeStats().lastInvalidResponse, expected);
    const app = appFor(service);
    try {
      const stats = await app.inject("/api/llm-chat/runtime-stats");
      assert.deepEqual(stats.json().lastInvalidResponse, expected); assert.equal(stats.body.includes(hidden), false);
      assert.equal(service.runtimeStats().attempts, 1); assert.equal(service.runtimeStats().failed, 1);
    } finally { await app.close(); }
  }
});
test("요청 간 대화 기록을 서버에서 섞지 않는다", async () => {
  const sent: unknown[][] = [];
  const service = createChatService({ config: () => config, fetch: async (_url, options) => { sent.push(JSON.parse(options!.body as string).messages); return success(); } });
  await service.complete([{ role: "user", content: "첫 사용자" }]);
  await service.complete([{ role: "user", content: "다른 사용자" }]);
  assert.equal(sent[0].length, 2); assert.equal(sent[1].length, 2); assert.equal(JSON.stringify(sent[1]).includes("첫 사용자"), false);
});
test("동시 요청 제한은 세 번째 호출을 차단하고 완료 후 해제된다", async () => {
  let release!: () => void;
  const wait = new Promise<void>(r => { release = r; });
  let calls = 0;
  const app = appFor(createChatService({ config: () => config, fetch: async () => { calls++; await wait; return success(); } }));
  try {
    const first = app.inject({ method: "POST", url: "/api/llm-chat/messages", payload }).then(r => r);
    const second = app.inject({ method: "POST", url: "/api/llm-chat/messages", payload }).then(r => r);
    for (let i = 0; calls < 2 && i < 100; i++) await new Promise(r => setTimeout(r, 5));
    assert.equal(calls, 2);
    const third = await app.inject({ method: "POST", url: "/api/llm-chat/messages", payload });
    assert.equal(third.statusCode, 429); assert.equal(third.json().code, "CHAT_BUSY");
    release(); assert.equal((await first).statusCode, 200); assert.equal((await second).statusCode, 200);
    assert.equal((await app.inject({ method: "POST", url: "/api/llm-chat/messages", payload })).statusCode, 200);
  } finally { release(); await app.close(); }
});
