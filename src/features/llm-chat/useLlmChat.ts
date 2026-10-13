import { useEffect, useRef, useState, type FormEvent } from "react";
import { ChatApiError, chatRequest, type ChatMessage, type ChatResponse, type PlanSnapshot,
  type ProposalCard, type RecordAttempt, type ProgressInput, type FeedbackInput, type StudentBinding, type StudentTarget, type ToolResult } from "./llm-chat.api";

type CardState = { card: ProposalCard; before: PlanSnapshot | null; status: "pending" | "held" | "confirmed" | "stale" };
type Operation = "bind" | "send" | "confirm" | "refresh" | "progress" | "feedback";

function matchesBasis(snapshot: PlanSnapshot | null, card: ProposalCard) {
  const expected = card.proposal.expectedBasis;
  // 제안의 카탈로그 해시는 추가·교체할 강좌까지 포함하므로 현재 선택 집합과 같을 필요가 없다.
  // 계획·실행 revision만 화면에서 비교하고, 카탈로그 유효성은 원본 basis를 전달해 서버가 검증한다.
  return snapshot ? expected.planId === snapshot.basis.planId && expected.currentVersionId === snapshot.basis.currentVersionId &&
    expected.planRevision === snapshot.basis.planRevision && expected.completionRevision === snapshot.basis.completionRevision : expected.planId === null;
}

export function useLlmChat() {
  const [students, setStudents] = useState<StudentTarget[]>([]);
  const [studentId, setStudentId] = useState("");
  const [binding, setBinding] = useState<StudentBinding | null>(null);
  const [bindingError, setBindingError] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [cards, setCards] = useState<CardState[]>([]);
  const [results, setResults] = useState<ToolResult[]>([]);
  const [plan, setPlan] = useState<PlanSnapshot | null>(null);
  const [planLoaded, setPlanLoaded] = useState(false);
  const [busy, setBusy] = useState<Operation | null>(null);
  const [error, setError] = useState("");
  const [planError, setPlanError] = useState("");
  const [setupError, setSetupError] = useState("");
  const [notice, setNotice] = useState("");
  const [recordAttempt, setRecordAttempt] = useState<RecordAttempt | null>(null);
  const [recordError, setRecordError] = useState("");
  const [recordNotice, setRecordNotice] = useState("");
  const [recordRejected, setRecordRejected] = useState(false);
  const [recorded, setRecorded] = useState({ progress: 0, feedback: 0 });
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [toolsEnabled, setToolsEnabled] = useState(false);
  const [loadingSetup, setLoadingSetup] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const setupController = useRef<AbortController | null>(null);
  const epoch = useRef(0);
  const thread = useRef<HTMLDivElement>(null);

  async function loadSetup() {
    setupController.current?.abort();
    const abort = new AbortController(); setupController.current = abort;
    const timer = window.setTimeout(() => abort.abort(), 15_000);
    setLoadingSetup(true); setSetupError("");
    try {
      const [status, targets] = await Promise.all([
        chatRequest<{ configured: boolean; toolsEnabled: boolean }>("/api/llm-chat/status", abort.signal),
        chatRequest<{ students: StudentTarget[] }>("/api/llm-chat/students", abort.signal),
      ]);
      if (abort.signal.aborted || setupController.current !== abort) return;
      if (!Array.isArray(targets.students)) throw new Error("학생 목록을 확인하지 못했습니다.");
      setConfigured(status.configured); setToolsEnabled(status.toolsEnabled); setStudents(targets.students);
    } catch (failure) {
      if (setupController.current === abort) setSetupError(failure instanceof Error ? failure.message : "학생 목록·서버 상태를 조회하지 못했습니다.");
    } finally {
      window.clearTimeout(timer);
      if (setupController.current === abort) { setupController.current = null; setLoadingSetup(false); }
    }
  }
  useEffect(() => {
    void loadSetup();
    return () => {
      epoch.current++; setupController.current?.abort(); controller.current?.abort();
      setupController.current = null; controller.current = null;
    };
  }, []);
  useEffect(() => { thread.current?.scrollTo({ top: thread.current.scrollHeight }); }, [messages, busy]);

  function begin(operation: Operation) {
    const abort = new AbortController(); controller.current = abort; setBusy(operation);
    const generation = epoch.current;
    const timer = window.setTimeout(() => abort.abort(), operation === "send" ? 70_000 : 20_000);
    return { abort, generation, timer };
  }
  function active(request: ReturnType<typeof begin>) {
    return request.generation === epoch.current && controller.current === request.abort;
  }
  function finish(request: ReturnType<typeof begin>) {
    window.clearTimeout(request.timer);
    if (active(request)) { controller.current = null; setBusy(null); }
  }
  function failureMessage(failure: unknown, request: ReturnType<typeof begin>) {
    return request.abort.signal.aborted ? "응답 대기 시간이 초과되었습니다. 마지막 정상 상태와 입력은 유지됩니다."
      : failure instanceof Error ? failure.message : "요청 처리에 실패했습니다. 다시 시도해주세요.";
  }
  async function readPlan(target: StudentBinding, signal: AbortSignal) {
    try {
      const snapshot = await chatRequest<PlanSnapshot>("/api/llm-chat/current", signal, { bindingToken: target.bindingToken });
      if (snapshot.plan.studentId !== target.studentId) throw new Error("선택한 학생의 계획 조회 결과가 아닙니다.");
      return snapshot;
    }
    catch (failure) {
      if (failure instanceof ChatApiError && failure.status === 404 && failure.code === "NOT_FOUND") return null;
      throw failure;
    }
  }
  async function refreshFor(target: StudentBinding, request: ReturnType<typeof begin>) {
    try {
      const snapshot = await readPlan(target, request.abort.signal);
      if (active(request)) { setPlan(snapshot); setPlanLoaded(true); setPlanError("");
        setCards(current => current.map(entry => {
          const unchanged = matchesBasis(snapshot, entry.card);
          return !unchanged && (entry.status === "pending" || entry.status === "held") ? { ...entry, status: "stale" } : entry;
        })); }
      return snapshot;
    } catch (failure) {
      if (active(request)) {
        if (failure instanceof ChatApiError && failure.code === "STUDENT_BINDING_INVALID") setBindingError(true);
        setPlanError(failureMessage(failure, request) + " 계획 다시 조회를 눌러주세요.");
      }
      return undefined;
    }
  }
  async function selectStudent(id: string) {
    // 학생 변경 시 이전 대화·제안·늦은 응답을 새 학생의 화면에 남기지 않는다.
    epoch.current++; controller.current?.abort(); controller.current = null;
    setStudentId(id); setBinding(null); setBindingError(false); setMessages([]); setDraft(""); setCards([]); setResults([]);
    setRecordAttempt(null); setRecordError(""); setRecordNotice(""); setRecordRejected(false); setRecorded({ progress: 0, feedback: 0 });
    setPlan(null); setPlanLoaded(false); setError(""); setPlanError(""); setNotice(""); setBusy(null);
    if (!id) return;
    const request = begin("bind");
    try {
      const target = await chatRequest<StudentBinding>("/api/llm-chat/bind", request.abort.signal, { studentId: id });
      if (!active(request)) return;
      if (target.studentId !== id || !target.bindingToken) throw new Error("선택한 학생 연결을 확인하지 못했습니다.");
      setBinding(target);
      await refreshFor(target, request);
    } catch (failure) { if (active(request)) setError(failureMessage(failure, request)); }
    finally { finish(request); }
  }
  async function refreshPlan() {
    if (controller.current || !binding) return;
    const request = begin("refresh");
    await refreshFor(binding, request); finish(request);
  }
  async function receiveCards(proposalCards: ProposalCard[], request: ReturnType<typeof begin>) {
    if (!binding || proposalCards.some(card => card.proposal.studentId !== binding.studentId)) throw new Error("선택한 학생의 변경안이 아닙니다.");
    const before = proposalCards.length ? await refreshFor(binding, request) : plan;
    if (!active(request)) return;
    setCards(current => [...current, ...proposalCards.filter(card =>
      !current.some(old => old.card.proposal.proposalId === card.proposal.proposalId))
      .map(card => ({ card, before: before === undefined ? plan : before,
        status: before !== undefined && !matchesBasis(before, card) ? "stale" as const : "pending" as const }))]);
  }
  async function reconnectStudent() {
    if (controller.current || !studentId) return;
    const request = begin("bind"); setError("");
    try {
      const target = await chatRequest<StudentBinding>("/api/llm-chat/bind", request.abort.signal, { studentId });
      if (!active(request)) return;
      if (target.studentId !== studentId || !target.bindingToken) throw new Error("선택한 학생 연결을 확인하지 못했습니다.");
      setBinding(target); setBindingError(false); setNotice("같은 학생 연결을 갱신했습니다. 보존된 입력을 다시 보낼 수 있습니다.");
      await refreshFor(target, request);
    } catch (failure) { if (active(request)) setError(failureMessage(failure, request)); }
    finally { finish(request); }
  }
  async function send(event: FormEvent) {
    event.preventDefault();
    if (controller.current || !binding || bindingError || !draft.trim()) return;
    const next: ChatMessage[] = [...messages, { role: "user", content: draft.trim() }];
    if (next.length > 31 || next.reduce((sum, message) => sum + message.content.length, 0) > 60_000) {
      setError("대화 길이 한도에 도달했습니다. 필요한 내용을 정리하고 새 대화를 시작해주세요."); return;
    }
    const request = begin("send"); setError(""); setNotice("");
    try {
      const data = await chatRequest<ChatResponse>("/api/llm-chat/messages", request.abort.signal,
        { bindingToken: binding.bindingToken, messages: next });
      if (!active(request)) return;
      if (data.message?.role !== "assistant" || typeof data.message.content !== "string" ||
        !Array.isArray(data.proposalCards) || !Array.isArray(data.toolResults) ||
        data.proposalCards.some(card => card.proposal.studentId !== binding.studentId)) throw new Error("올바른 대화·제안 응답을 받지 못했습니다.");
      setMessages([...next, data.message]); setDraft(""); setResults(data.toolResults);
      await receiveCards(data.proposalCards, request);
    } catch (failure) {
      if (active(request)) {
        if (failure instanceof ChatApiError && failure.code === "STUDENT_BINDING_INVALID") setBindingError(true);
        setError(failureMessage(failure, request) + " 다시 보내면 제공사 요청 비용이 추가될 수 있습니다.");
        if (failure instanceof ChatApiError && failure.details) {
          // 설명 응답이 실패해도 서버가 실제로 저장한 제안만 별도 확인 대상으로 보여준다.
          try {
            setResults(failure.details.toolResults);
            await receiveCards(failure.details.proposalCards, request);
            if (active(request) && failure.details.proposalCards.length) setNotice("AI 설명은 실패했지만 서버 변경안은 보존됐습니다. 아래 내용을 직접 검토해주세요. 확인 전 계획은 바뀌지 않습니다.");
          } catch { if (active(request)) setError("선택한 학생의 서버 변경안을 확인하지 못했습니다. 입력과 기존 상태는 보존됩니다."); }
        }
      }
    } finally { finish(request); }
  }
  async function confirm(card: ProposalCard) {
    if (controller.current || recordAttempt || planError || !binding || bindingError || card.proposal.studentId !== binding.studentId) return;
    const request = begin("confirm"); setError(""); setNotice("");
    try {
      await chatRequest("/api/llm-chat/confirm", request.abort.signal, {
        bindingToken: binding.bindingToken, proposalId: card.proposal.proposalId, expectedBasis: card.proposal.expectedBasis,
      });
      if (!active(request)) return;
      setCards(current => current.map(entry => ({ ...entry, status: entry.card.proposal.proposalId === card.proposal.proposalId
        ? "confirmed" : entry.status === "pending" || entry.status === "held" ? "stale" : entry.status })));
      setNotice("변경안을 확정했습니다. 서버 계획을 다시 조회합니다.");
      await refreshFor(binding, request);
    } catch (failure) {
      if (!active(request)) return;
      if (failure instanceof ChatApiError && failure.code === "STUDENT_BINDING_INVALID") setBindingError(true);
      if (failure instanceof ChatApiError && failure.status === 409) {
        setCards(current => current.map(entry => entry.card.proposal.proposalId === card.proposal.proposalId ? { ...entry, status: "stale" } : entry));
        setError(failure.message + " 오래되거나 만료된 변경안입니다. 현재 계획을 확인하고 새 변경안을 요청해주세요.");
        await refreshFor(binding, request);
      } else setError(failureMessage(failure, request) + " 확정 여부가 불명확하면 계획을 다시 조회하세요. 재시도는 같은 제안으로 처리됩니다.");
    } finally { finish(request); }
  }
  function resetChat() {
    if (controller.current || !window.confirm("현재 대화와 미확정 변경안을 화면에서 지울까요? 저장된 계획은 유지됩니다.")) return;
    setMessages([]); setCards([]); setResults([]); setDraft(""); setError(""); setNotice("");
  }


  async function saveRecord(attempt: RecordAttempt) {
    if (controller.current || !binding || bindingError) return;
    const request = begin(attempt.kind); setRecordError(""); setRecordNotice(""); setRecordRejected(false);
    // 키와 내용은 첫 전송 전에 고정하며 응답이 불명확해도 같은 기록으로 재전송한다.
    setRecordAttempt(attempt);
    try {
      const result = await chatRequest<{ replayed: boolean; progress?: unknown; completion?: unknown }>("/api/llm-chat/" + attempt.kind, request.abort.signal,
        { bindingToken: binding.bindingToken, ...attempt.payload });
      if (!active(request)) return;
      if (typeof result.replayed !== "boolean" || (attempt.kind === "progress" ? !result.progress : !result.completion)) {
        throw new Error("올바른 기록 결과를 확인하지 못했습니다.");
      }
      setRecordAttempt(null);
      setRecorded(current => ({ ...current, [attempt.kind]: current[attempt.kind] + 1 }));
      setCards(current => current.map(entry => entry.status === "pending" || entry.status === "held" ? { ...entry, status: "stale" } : entry));
      setRecordNotice("학습 기록을 저장했습니다. 이전 변경안은 다시 사용하지 말고 새 변경안을 요청해주세요.");
      await refreshFor(binding, request);
    } catch (failure) {
      if (!active(request)) return;
      if (failure instanceof ChatApiError && failure.code === "STUDENT_BINDING_INVALID") setBindingError(true);
      const rejected = failure instanceof ChatApiError && (failure.status === 400 || failure.status === 422);
      setRecordRejected(rejected);
      setRecordError(failureMessage(failure, request) + (rejected ? " 서버가 입력을 거절했습니다. 원래 내용으로 재시도하거나 별도 새 기록으로 수정해주세요."
        : " 저장 여부가 불명확할 수 있습니다. 아래 같은 기록 재시도는 원래 내용·키를 사용합니다."));
    } finally { finish(request); }
  }
  function recordProgress(input: ProgressInput) {
    if (recordAttempt || planError || !plan) return;
    void saveRecord({ kind: "progress", payload: { ...input, idempotencyKey: crypto.randomUUID() } });
  }
  function recordFeedback(input: FeedbackInput) {
    if (recordAttempt || planError || !plan) return;
    void saveRecord({ kind: "feedback", payload: { ...input, idempotencyKey: crypto.randomUUID() } });
  }
  function retryRecord() { if (recordAttempt) void saveRecord(recordAttempt); }
  function editRejectedRecord() {
    if (controller.current || !recordRejected) return;
    setRecordAttempt(null); setRecordRejected(false); setRecordError("");
    setRecordNotice("서버가 거절한 기록을 종료했습니다. 입력을 수정해 저장하면 새 키로 별도의 기록을 전송합니다. 같은 기록 재시도가 아닙니다.");
  }

  return { students, studentId, binding, bindingError, messages, draft, setDraft, cards, setCards, results, plan, planLoaded,
    busy, error, planError, setupError, notice, configured, toolsEnabled, loadingSetup, thread,
    loadSetup, selectStudent, reconnectStudent, send, confirm, resetChat, refreshPlan,
    recordAttempt, recordError, recordNotice, recordRejected, recorded, recordProgress, recordFeedback, retryRecord, editRejectedRecord };
}
