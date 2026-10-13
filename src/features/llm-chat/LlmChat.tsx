import { CandidateView, ConditionsView, duration, PlanView } from "./PlanPreview";
import { LearningRecorder } from "./LearningRecorder";
import { useLlmChat } from "./useLlmChat";
import "./llm-chat.css";

export function LlmChat() {
  const { students, studentId, binding, bindingError, messages, draft, setDraft, cards, setCards, results, plan, planLoaded,
    busy, error, planError, setupError, notice, configured, toolsEnabled, loadingSetup, thread,
    loadSetup, selectStudent, reconnectStudent, send, confirm, resetChat, refreshPlan,
    recordAttempt, recordError, recordNotice, recordRejected, recorded, recordProgress, recordFeedback, retryRecord, editRejectedRecord } = useLlmChat();
  return <main className="llm-chat">
    <header><div><span>아주LLM · 로컬 개발용</span><h1>AI 담임과 대화하기</h1></div>
      <button disabled={!!busy || (!messages.length && !cards.length)} onClick={resetChat}>새 대화</button></header>
    <p className="llm-notice">학생을 선택한 뒤 계획을 질문하거나 변경안을 요청하세요. 변경은 카드의 별도 확인 버튼으로 적용합니다.
      대화와 학생 선택은 새로고침·화면 이동 시 사라집니다. 개인정보는 입력하지 마세요.</p>
    <div className="llm-student-selector">
      <label htmlFor="llm-student">학생 선택 (로컬 개발용)</label>
      <select id="llm-student" value={studentId} disabled={busy === "confirm" || busy === "progress" || busy === "feedback" || loadingSetup} onChange={event => void selectStudent(event.target.value)}>
        <option value="">학생을 선택해주세요</option>
        {students.map(student => <option key={student.studentId} value={student.studentId}>{student.studentId} · {student.hasLearningPlan ? "계획 있음" : "계획 없음"}</option>)}
      </select>
      <p>인증 없는 개발용 선택 기능입니다. 공개 서비스나 실제 학생 검증용으로 사용하지 마세요.</p>
      <button disabled={loadingSetup || !!busy} onClick={() => void loadSetup()}>목록·연결 상태 다시 조회</button>
      {busy === "bind" && <span role="status">학생·계획을 연결하고 있습니다…</span>}
      {studentId && !binding && !busy && <button onClick={() => void selectStudent(studentId)}>학생 연결 재시도</button>}
      {bindingError && <button disabled={!!busy} onClick={() => void reconnectStudent()}>같은 학생 다시 연결</button>}
    </div>
    {setupError && <p className="llm-error" role="alert">{setupError} 목록·연결 상태 다시 조회를 눌러주세요.</p>}
    {configured === false && <p role="status">서버의 아주LLM 키·모델 설정이 필요합니다. 설정 후 연결 상태를 다시 조회해주세요.</p>}
    {!toolsEnabled && configured !== null && <p role="status">서버의 학습 도구 연결이 준비되지 않았습니다.</p>}
    <div className="llm-thread" ref={thread} role="log" aria-label="LLM 대화" aria-live="polite">
      {!messages.length && <p>{binding ? "원하는 강좌·기한·시간이나 변경 조건을 입력해주세요." : "먼저 대화할 학생을 선택해주세요."}</p>}
      {messages.map((message, index) => <article key={index} className={"llm-message " + message.role}>
        <strong>{message.role === "user" ? "나" : "AI 담임"}</strong><p>{message.content}</p></article>)}
      {busy === "send" && <article className="llm-message user"><strong>전송 중</strong><p>{draft}</p><span>AI 응답을 기다리고 있습니다…</span></article>}
    </div>
    {error && <p className="llm-error" role="alert">{error}</p>}
    {notice && <p className="llm-feedback" role="status">{notice}</p>}
    <form className="llm-chat-composer" onSubmit={send}>
      <label htmlFor="llm-input">메시지</label>
      <textarea id="llm-input" value={draft} maxLength={4000} rows={3} disabled={!!busy} onChange={event => setDraft(event.target.value)} placeholder="예: 오늘만 학습 시간을 50분으로 바꿔줘" />
      <button type="submit" disabled={!!busy || !binding || bindingError || !draft.trim() || configured !== true || !toolsEnabled}>{busy === "send" ? "응답 대기 중" : error ? "다시 보내기" : "보내기"}</button>
    </form>
    {results.filter(result => result.kind !== "proposed" && (result.code || result.message || result.issues?.length)).map((result, index) =>
      <section key={index} className="llm-tool-result" aria-label="학습 도구 결과"><h2>{result.code === "SEARCH_LIMIT" ? "계산 범위의 한계" : "학습 도구 안내"}</h2>
        <p>{result.message ?? (result.code === "SEARCH_LIMIT" ? "제한된 탐색으로 계획을 찾지 못했습니다. 불가능하다는 확정 판정은 아닙니다."
          : result.code === "INSUFFICIENT_CAPACITY" ? "기간의 학습 가능 시간이 부족합니다. 기한·시간 대안을 확인해주세요." : "요청 조건을 확인해주세요.")}</p>
        {result.issues?.map((issue, i) => <p key={i}>{issue.date} {issue.message ?? issue.code}</p>)}
        {result.alternatives?.map((alternative, i) => <p key={i}>{alternative.kind === "extend-deadline" ? "기한 연장 대안: " + alternative.deadlineDate
          : alternative.kind === "increase-time" ? "추가로 필요한 총시간 하한: " + duration(alternative.additionalCapacitySecondsLowerBound ?? 0) + " (이 시간만 추가하면 성공한다는 보장은 없습니다.)" : "조건을 바꾸어 다시 요청해주세요."}</p>)}
      </section>)}
    {cards.map(({ card, before, status }) => <section key={card.proposal.proposalId} className="llm-proposal-card" aria-label="학습 계획 변경안">
      <h2>학습 계획 변경안 {status === "confirmed" ? "· 확정됨" : status === "held" ? "· 보류 중" : status === "stale" ? "· 새 제안 필요" : "· 확인 대기"}</h2>
      <div className="llm-comparison"><div><h3>현재 조건 (마지막 서버 조회)</h3><ConditionsView conditions={before?.version.candidate.conditions ?? null} /></div>
        <div><h3>변경할 조건</h3><ConditionsView conditions={card.candidate.conditions} /></div></div>
      <p>영향을 받는 날짜: {card.diff.affectedDates?.join(" · ") || "없음"}</p>
      <p>추가 강좌: {card.diff.addedCourseIds?.join(" · ") || "없음"} / 제외 강좌: {card.diff.removedCourseIds?.join(" · ") || "없음"}</p>
      {card.diff.noChange && <p>서버 계산 결과 현재 조건·일정과 동일합니다.</p>}
      <CandidateView candidate={card.candidate} />
      {card.warnings.map((warning, i) => <p key={i}>{typeof warning === "string" ? warning : warning.message ?? warning.code}</p>)}
      <p>확인 가능 기한: {new Date(card.proposal.expiresAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} (한국 시간)</p>
      {status === "pending" && <div className="llm-actions"><button disabled={!!busy || bindingError || !!recordAttempt || !!planError} onClick={() => void confirm(card)}>변경안을 확인하고 적용</button>
        <button disabled={!!busy} onClick={() => setCards(current => current.map(entry => entry.card === card ? { ...entry, status: "held" } : entry))}>지금은 보류</button></div>}
      {status === "held" && <><p>현재 계획은 그대로 유지됩니다.</p><button disabled={!!busy} onClick={() => setCards(current => current.map(entry => entry.card === card ? { ...entry, status: "pending" } : entry))}>변경안 다시 검토</button></>}
      {status === "stale" && <p>현재 계획을 확인한 뒤 대화로 새 변경안을 요청해주세요.</p>}
    </section>)}
    {binding && <section className="llm-plan-panel" aria-label="서버 학습 계획"><header><h2>현재 저장된 전체 계획</h2>
      <button disabled={!!busy} onClick={() => void refreshPlan()}>계획 다시 조회</button></header>
      {planError && <p className="llm-error" role="alert">{planError} 마지막 정상 조회 결과를 유지합니다.</p>}
      {planLoaded ? <PlanView plan={plan} /> : <p>아직 계획을 조회하지 못했습니다.</p>}
      {recordError && <p className="llm-error" role="alert">{recordError}</p>}
      {recordNotice && <p className="llm-feedback" role="status">{recordNotice}</p>}
      {recordAttempt && <div className="llm-record-retry">
        <p>전송한 {recordAttempt.kind === "progress" ? "진도" : "피드백"} 기록을 그대로 보존하고 있습니다.
          새 기록은 이 요청의 결과를 확인한 뒤 입력하세요. 입력 내용을 바꿔 재시도하지 않습니다.</p>
        {recordAttempt.kind === "progress" && <p>보존된 실제 위치: {recordAttempt.payload.positionSeconds}초 ·
          이번 실제 사용시간: {recordAttempt.payload.spentSeconds}초</p>}
        <button disabled={!!busy || bindingError} onClick={retryRecord}>같은 기록 재시도</button>
        {recordRejected && <button disabled={!!busy} onClick={editRejectedRecord}>거절된 기록을 종료하고 새 기록으로 수정</button>}
      </div>}
      {plan?.learningView && <LearningRecorder key={studentId} view={plan.learningView}
        disabled={!!busy || bindingError || !!planError || !!recordAttempt} recorded={recorded}
        onProgress={recordProgress} onFeedback={recordFeedback} />}
    </section>}
  </main>;
}
