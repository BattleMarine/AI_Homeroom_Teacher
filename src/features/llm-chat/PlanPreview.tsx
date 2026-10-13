import type { LearningView, PlanCandidate, PlanConditions, PlanSnapshot } from "./llm-chat.api";

export function duration(seconds: number) {
  return `${Number((seconds / 60).toFixed(2))}분`;
}

export function ConditionsView({ conditions }: { conditions: PlanConditions | null }) {
  if (!conditions) return <p>등록된 계획 없음</p>;
  return <>
    <dl className="llm-conditions">
      <div><dt>시작일</dt><dd>{conditions.startDate}</dd></div>
      <div><dt>마감일</dt><dd>{conditions.deadlineDate}</dd></div>
      <div><dt>평소 하루 총시간</dt><dd>{duration(conditions.availableSecondsPerDay)}</dd></div>
    </dl>
    <p>날짜별 총시간 예외: {conditions.dateOverrides.length
      ? conditions.dateOverrides.map(day => `${day.date} ${duration(day.totalSeconds)}`).join(" · ") : "없음"}</p>
  </>;
}

export function CandidateView({ candidate }: { candidate: PlanCandidate }) {
  const lessonTitle = (lessonId: string) => candidate.catalogSnapshot
    .flatMap(selection => selection.catalog.lessons).find(lesson => lesson.id === lessonId)?.title ?? lessonId;
  return <>
    <p>대상 강의 {candidate.items.length}개 · 예정 시청 구간 {candidate.assignments.length}개</p>
    <details className="llm-schedule"><summary>날짜별 예정 시청 구간 보기</summary>
      {candidate.assignments.length ? <div className="llm-table-scroll"><table>
        <caption>서버가 계산한 예정 일정이며 실제 수강 기록과 구분됩니다.</caption>
        <thead><tr><th scope="col">날짜</th><th scope="col">과목·강의</th><th scope="col">예정 시청 구간</th><th scope="col">분량</th></tr></thead>
        <tbody>{candidate.assignments.map(assignment => <tr key={assignment.segmentKey}>
          <td>{assignment.date}</td><td>{assignment.subjectCode} · {lessonTitle(assignment.lessonId)}</td>
          <td>{duration(assignment.startOffsetSeconds)} ~ {duration(assignment.endOffsetSeconds)}</td><td>{duration(assignment.durationSeconds)}</td>
        </tr>)}</tbody>
      </table></div> : <p>편성된 예정 구간이 없습니다.</p>}
    </details>
  </>;
}

export function PlanView({ plan }: { plan: PlanSnapshot | null }) {
  if (!plan) return <p>등록된 전체 계획이 없습니다. 강좌·기한·학습 가능 시간을 대화로 알려주세요.</p>;
  return <div>
    <p>서버 계획 버전 {plan.version.versionNumber} · 실제 완료 {plan.completions.length}개</p>
    {plan.learningView ? <LearningStatus view={plan.learningView} /> : <p role="alert">서버의 학습 표시 계약이 준비되지 않았습니다. 기록 입력은 사용할 수 없습니다.</p>}
    <ConditionsView conditions={plan.version.candidate.conditions} />
    <CandidateView candidate={{ ...plan.version.candidate, assignments: plan.assignments }} />
    <details><summary>날짜별 실제 사용시간과 진도 보기</summary>
      <div className="llm-table-scroll"><table><caption>예정 시간과 실제 사용시간은 각각 서버 조회값입니다.</caption>
        <thead><tr><th scope="col">날짜</th><th scope="col">총한도</th><th scope="col">실제 사용</th><th scope="col">원본 예정</th><th scope="col">한도 내 여유</th><th scope="col">예정 구간 미수강 잔여</th></tr></thead>
        <tbody>{(plan.learningView?.days ?? plan.days).map(day => <tr key={day.date}><td>{day.date}</td><td>{duration(day.totalSeconds)}</td>
          <td>{duration(day.spentSeconds)}</td><td>{duration(day.scheduledSeconds)}</td><td>{duration(day.remainingSeconds)}</td>
          <td>{"remainingScheduledSeconds" in day ? duration(day.remainingScheduledSeconds as number) : "조회값 없음"}</td></tr>)}</tbody>
      </table></div>
      <p>부분 수강 위치는 예정 구간을 완료 처리하지 않습니다.</p>
      <ul>{plan.progress.map(progress => <li key={progress.itemKey}>
        {plan.version.candidate.items.find(item => item.itemKey === progress.itemKey)?.lessonId ?? "이전 수강 항목"}: 실제 위치 {duration(progress.positionSeconds)}
      </li>)}</ul>
    </details>
  </div>;
}

function LearningStatus({ view }: { view: LearningView }) {
  return <>
    <section aria-label="오늘 학습 분량" className="llm-today">
      <h3>오늘 학습 분량 · {view.todayDate} (한국 시간)</h3>
      {!view.today.inPlanPeriod && <p>오늘은 현재 계획 기간 밖입니다.</p>}
      <p>총한도 {duration(view.today.totalSeconds)} · 실제 사용 {duration(view.today.spentSeconds)} ·
        한도 내 여유 {duration(view.today.remainingSeconds)} · 원본 예정 {duration(view.today.scheduledSeconds)} ·
        예정 구간 미수강 잔여 {duration(view.today.remainingScheduledSeconds)}</p>
      <p>모든 시간과 잔여는 서버 조회값입니다. 예정 구간 완료와 강의 전체 실제 완료는 다릅니다.</p>
      {view.today.assignments.length ? <ul>{view.today.assignments.map(assignment => <li key={assignment.segmentKey}>
        {assignment.subjectCode} · {assignment.lessonTitle ?? "강의 제목 정보 없음"}: 예정 {duration(assignment.startOffsetSeconds)} ~ {duration(assignment.endOffsetSeconds)} ·
        이 구간의 미수강 잔여 {duration(assignment.remainingSeconds)} · {assignment.completed ? "구간 수강 완료" : "구간 미완료"}
      </li>)}</ul> : <p>오늘 예정된 시청 구간은 없습니다.</p>}
    </section>
    <details className="llm-actual-items"><summary>강의별 실제 잔여·완료·피드백 보기</summary>
      <ul>{view.items.map(item => <li key={item.itemKey}>
        {item.subjectCode} · {item.lessonTitle ?? "강의 제목 정보 없음"} · {item.courseTitle ?? "강좌 제목 정보 없음"}: 실제 위치 {duration(item.positionSeconds)} ·
        실제 잔여 {duration(item.remainingSeconds)} · {item.completed ? "강의 전체 완료" : "강의 전체 미완료"}
        {item.completedAt && <span> · 완료 시각 {new Date(item.completedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</span>}
        {item.metadataMissing && <span> · 메타데이터 누락</span>}
        {item.feedbackSubmitted ? <p>첫 피드백 저장됨: 이해도 {item.feedback?.understandingLevel} · 집중도 {item.feedback?.focusLevel}
          {item.feedback?.weakConcepts?.length ? " · 어려운 개념: " + item.feedback.weakConcepts.join(", ") : ""}
          {item.feedback?.comment ? " · " + item.feedback.comment : ""}</p> : item.completed && <p>첫 피드백 미입력</p>}
      </li>)}</ul>
    </details>
  </>;
}
