import { useEffect, useState, type FormEvent } from "react";
import type { FeedbackInput, LearningItem, LearningView, ProgressInput } from "./llm-chat.api";
import { duration } from "./PlanPreview";

const itemName = (item: LearningItem) => `${item.subjectCode} · ${item.lessonTitle ?? "강의 제목 정보 없음"} · ${item.courseTitle ?? "강좌 제목 정보 없음"}`;

export function LearningRecorder({ view, disabled, recorded, onProgress, onFeedback }: {
  view: LearningView; disabled: boolean; recorded: { progress: number; feedback: number };
  onProgress: (input: ProgressInput) => void; onFeedback: (input: FeedbackInput) => void;
}) {
  const [itemKey, setItemKey] = useState("");
  const [position, setPosition] = useState("");
  const [spent, setSpent] = useState("");
  const [finished, setFinished] = useState(false);
  const [feedbackKey, setFeedbackKey] = useState("");
  const [understanding, setUnderstanding] = useState("");
  const [focus, setFocus] = useState("");
  const [comment, setComment] = useState("");
  const item = view.items.find(entry => entry.itemKey === itemKey && !entry.completed);
  const feedbackItem = view.items.find(entry => entry.itemKey === feedbackKey && entry.completed && !entry.feedbackSubmitted);
  useEffect(() => { setPosition(""); setSpent(""); setFinished(false); }, [recorded.progress]);
  useEffect(() => { setUnderstanding(""); setFocus(""); setComment(""); }, [recorded.feedback]);

  function progress(event: FormEvent) {
    event.preventDefault();
    if (disabled || !item) return;
    const positionSeconds = finished ? item.durationSeconds : Number(position);
    const spentSeconds = Number(spent);
    if ((!finished && !position) || !spent || !Number.isSafeInteger(positionSeconds) || !Number.isSafeInteger(spentSeconds) ||
      positionSeconds < item.positionSeconds || positionSeconds > item.durationSeconds || spentSeconds < 0 || spentSeconds > 86400) return;
    onProgress({ itemKey: item.itemKey, positionSeconds, spentSeconds });
  }
  function feedback(event: FormEvent) {
    event.preventDefault();
    if (disabled || !feedbackItem || !understanding || !focus) return;
    onFeedback({ itemKey: feedbackItem.itemKey, feedback: {
      understandingLevel: Number(understanding), focusLevel: Number(focus), ...(comment.trim() ? { comment: comment.trim() } : {}),
    } });
  }
  return <section className="llm-record-panel" aria-label="수동 학습 기록">
    <h3>수동 학습 기록 (검증용)</h3>
    <p>자동 시청 추적이 아닙니다. 영상 처음부터의 실제 도달 위치와 이번에 실제로 공부한 시간을 각각 입력하세요.
      예정 구간이나 예정 분량을 실제 수강으로 처리하지 않습니다. 사용 날짜는 서버의 오늘 (한국 시간)로 기록됩니다.</p>
    <form className="llm-progress-form" onSubmit={progress}>
      <fieldset disabled={disabled}><legend>부분 수강·완료</legend>
        <label htmlFor="llm-record-item">기록할 강의</label>
        <select id="llm-record-item" required value={itemKey} onChange={event => {
          setItemKey(event.target.value); setPosition(""); setSpent(""); setFinished(false);
        }}><option value="">강의를 선택해주세요</option>
          {view.items.filter(entry => !entry.completed).map(entry => <option key={entry.itemKey} value={entry.itemKey}>{itemName(entry)}</option>)}
        </select>
        {item && <p>서버 실제 위치 {item.positionSeconds}초 · 원본 길이 {item.durationSeconds}초 ·
          실제 잔여 {duration(item.remainingSeconds)}{item.metadataMissing ? " · 메타데이터 누락" : ""}</p>}
        <label><input type="checkbox" checked={finished} onChange={event => setFinished(event.target.checked)} />강의 전체를 실제로 끝까지 수강했습니다</label>
        <label htmlFor="llm-record-position">영상 처음부터 실제 도달 위치 (초)</label>
        <input id="llm-record-position" type="number" step="1" min={item?.positionSeconds ?? 0} max={item?.durationSeconds}
          value={finished && item ? item.durationSeconds : position} required={!finished} disabled={finished}
          onChange={event => setPosition(event.target.value)} />
        <label htmlFor="llm-record-spent">이번 기록의 실제 사용시간 (초)</label>
        <input id="llm-record-spent" type="number" step="1" min="0" max="86400" required value={spent} onChange={event => setSpent(event.target.value)} />
        <p>사용시간은 이번 기록 한 번의 시간입니다. 누적 위치나 예정 시간과 같다고 가정하지 않습니다.</p>
        <button type="submit" disabled={!item}>진도·완료 기록 저장</button>
      </fieldset>
    </form>
    <form className="llm-feedback-form" onSubmit={feedback}>
      <fieldset disabled={disabled}><legend>완료 강의의 첫 피드백</legend>
        <label htmlFor="llm-feedback-item">피드백할 완료 강의</label>
        <select id="llm-feedback-item" required value={feedbackKey} onChange={event => {
          setFeedbackKey(event.target.value); setUnderstanding(""); setFocus(""); setComment("");
        }}><option value="">완료 후 피드백할 강의를 선택해주세요</option>
          {view.items.filter(entry => entry.completed && !entry.feedbackSubmitted).map(entry => <option key={entry.itemKey} value={entry.itemKey}>{itemName(entry)}</option>)}
        </select>
        <label htmlFor="llm-feedback-understanding">이해도 (1~5)</label>
        <select id="llm-feedback-understanding" required value={understanding} onChange={event => setUnderstanding(event.target.value)}>
          <option value="">이해도 선택</option>{[1, 2, 3, 4, 5].map(level => <option key={level} value={level}>{level}</option>)}
        </select>
        <label htmlFor="llm-feedback-focus">집중도 (1~5)</label>
        <select id="llm-feedback-focus" required value={focus} onChange={event => setFocus(event.target.value)}>
          <option value="">집중도 선택</option>{[1, 2, 3, 4, 5].map(level => <option key={level} value={level}>{level}</option>)}
        </select>
        <label htmlFor="llm-feedback-comment">피드백 메모 (선택)</label>
        <textarea id="llm-feedback-comment" maxLength={2000} value={comment} onChange={event => setComment(event.target.value)} />
        <button type="submit" disabled={!feedbackItem}>첫 피드백 저장</button>
      </fieldset>
    </form>
  </section>;
}
