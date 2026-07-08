import { useMemo, useState } from "react";
import {
  getCurriculums,
  type Curriculum,
  type CurriculumId,
} from "../features/curriculum";
import type { LearningRecommendation } from "../features/learning-check";
import { createDemoSessionData } from "../mock/demo-session.data";
import type { LessonItem, LessonItemKind } from "../types/shared.types";

const kindLabels: Record<LessonItemKind, string> = {
  lecture: "강의",
  review: "보강",
  practice: "연습",
  check: "확인",
};

const recommendationLabels: Record<LearningRecommendation, string> = {
  insert_review: "보강 삽입",
  delay_progress: "진도 연기",
  reduce_next_session_load: "수업량 축소",
  keep_pace: "진도 유지",
};

const curriculumOptions = getCurriculums();

export function App() {
  const [selectedCurriculumId, setSelectedCurriculumId] =
    useState<CurriculumId>("stable-log");
  const {
    demoCurriculumSteps,
    demoLearningCheckAnalysis,
    demoLearningCheckSubmission,
    demoNextSession,
    demoStudentState,
    demoTodaySession,
  } = useMemo(
    () => createDemoSessionData(selectedCurriculumId),
    [selectedCurriculumId],
  );
  const progressPercent = Math.round(
    (demoStudentState.completedStepCount / demoStudentState.totalStepCount) * 100,
  );
  const problemAccuracyPercent =
    demoLearningCheckAnalysis.problemAccuracy === null
      ? null
      : Math.round(demoLearningCheckAnalysis.problemAccuracy * 100);

  return (
    <main className="app-shell">
      <section className="top-band" aria-labelledby="page-title">
        <div className="eyebrow">AI 담임 서비스 데모 · 수학 I 로그함수</div>
        <div className="hero-layout">
          <div>
            <h1 id="page-title">오늘 수업은 이렇게 진행하겠습니다</h1>
            <p className="hero-copy">{demoTodaySession.teacherComment}</p>
            <div className="action-row" aria-label="오늘 수업 주요 행동">
              <button type="button">오늘 수업 시작</button>
              <button type="button" className="secondary-button">
                오늘 시간이 부족해요
              </button>
              <button type="button" className="ghost-button">
                왜 이렇게 배정됐나요?
              </button>
            </div>
          </div>

          <aside className="status-panel" aria-label="현재 학습 상태">
            <div className="status-label">현재 커리큘럼</div>
            <strong>{demoStudentState.selectedCurriculumTitle}</strong>
            <span>{demoStudentState.currentStepTitle} 진행 중</span>
            <div className="progress-track" aria-label={`진도율 ${progressPercent}%`}>
              <div style={{ width: `${progressPercent}%` }} />
            </div>
            <span>
              {demoStudentState.completedStepCount}/{demoStudentState.totalStepCount}단계 완료
            </span>
          </aside>
        </div>
      </section>

      <section className="curriculum-selector" aria-labelledby="curriculum-selector-title">
        <div className="section-heading">
          <div>
            <span className="eyebrow">커리큘럼 선택</span>
            <h2 id="curriculum-selector-title">오늘 수업 기준을 선택하세요</h2>
          </div>
        </div>

        <div className="curriculum-card-list">
          {curriculumOptions.map((curriculum) => (
            <CurriculumCard
              curriculum={curriculum}
              isSelected={curriculum.id === selectedCurriculumId}
              key={curriculum.id}
              onSelect={setSelectedCurriculumId}
            />
          ))}
        </div>
      </section>

      <section className="content-grid" aria-label="오늘 수업과 커리큘럼 상태">
        <article className="today-session">
          <div className="section-heading">
            <div>
              <span className="eyebrow">오늘 목표</span>
              <h2>{demoTodaySession.goal}</h2>
            </div>
            <strong>{demoTodaySession.estimatedMinutes}분</strong>
          </div>

          <div className="lesson-list">
            {demoTodaySession.items.map((item, index) => (
              <article className="lesson-item" key={item.id}>
                <div className="lesson-index">{index + 1}</div>
                <div>
                  <div className="lesson-meta">
                    <span>{kindLabels[item.kind]}</span>
                    <span>{item.estimatedMinutes}분</span>
                    <span>{item.required ? "필수" : "선택"}</span>
                  </div>
                  <h3>{item.title}</h3>
                  <p>{item.description}</p>
                  <div className="tag-row">
                    {item.conceptTags.map((tag) => (
                      <span key={tag}>{tag}</span>
                    ))}
                  </div>
                </div>
                <strong>{item.reason}</strong>
              </article>
            ))}
          </div>
        </article>

        <aside className="side-stack">
          <section className="teacher-note" aria-labelledby="reason-title">
            <span className="eyebrow">AI 담임 판단</span>
            <h2 id="reason-title">왜 이렇게 배정됐나요?</h2>
            <p>{demoTodaySession.adjustmentReason}</p>
          </section>

          <section className="weak-concepts" aria-labelledby="weak-title">
            <span className="eyebrow">보강 필요 개념</span>
            <h2 id="weak-title">오늘 먼저 잡을 부분</h2>
            <div className="tag-row strong-tags">
              {demoStudentState.weakConcepts.map((concept) => (
                <span key={concept}>{concept}</span>
              ))}
            </div>
          </section>
        </aside>
      </section>

      <section className="adjustment-grid" aria-label="학습 후 체크와 다음 수업 조율 결과">
        <article className="learning-summary" aria-labelledby="learning-check-title">
          <div className="section-heading">
            <div>
              <span className="eyebrow">학습 후 체크</span>
              <h2 id="learning-check-title">오늘 결과를 이렇게 반영했습니다</h2>
            </div>
          </div>

          <dl className="summary-list">
            <div>
              <dt>이해도</dt>
              <dd>{demoLearningCheckSubmission.understandingLevel}/5</dd>
            </div>
            <div>
              <dt>집중도</dt>
              <dd>{demoLearningCheckSubmission.focusLevel}/5</dd>
            </div>
            <div>
              <dt>확인 문제</dt>
              <dd>
                {demoLearningCheckSubmission.problemResult.correctCount}/
                {demoLearningCheckSubmission.problemResult.totalCount}개 정답
                {problemAccuracyPercent !== null ? ` · ${problemAccuracyPercent}%` : ""}
              </dd>
            </div>
            <div>
              <dt>조율 판단</dt>
              <dd>
                {demoLearningCheckAnalysis.recommendedActions
                  .map((action) => recommendationLabels[action])
                  .join(" · ")}
              </dd>
            </div>
          </dl>

          <div className="tag-row strong-tags">
            {demoLearningCheckAnalysis.reviewConcepts.map((concept) => (
              <span key={concept}>{concept}</span>
            ))}
          </div>
        </article>

        <article className="next-session" aria-labelledby="next-session-title">
          <div className="section-heading">
            <div>
              <span className="eyebrow">조율된 다음 수업</span>
              <h2 id="next-session-title">{demoNextSession.goal}</h2>
            </div>
            <strong>{demoNextSession.estimatedMinutes}분</strong>
          </div>

          <p className="teacher-comment">{demoNextSession.teacherComment}</p>
          <p>{demoNextSession.adjustmentReason}</p>

          <div className="compact-lesson-list">
            {demoNextSession.items.map((item, index) => (
              <LessonRow item={item} index={index} key={item.id} />
            ))}
          </div>
        </article>
      </section>

      <section className="curriculum-map" aria-labelledby="map-title">
        <div className="section-heading">
          <div>
            <span className="eyebrow">커리큘럼 맵</span>
            <h2 id="map-title">진도와 취약 개념 상태</h2>
          </div>
          <button type="button" className="secondary-button">
            전체 커리큘럼 보기
          </button>
        </div>

        <ol className="step-list">
          {demoCurriculumSteps.map((step) => (
            <li className={`step-item step-${step.status.replace(/\s/g, "-")}`} key={step.id}>
              <div>
                <strong>{step.title}</strong>
                <span>{step.conceptTags.join(" · ")}</span>
              </div>
              <em>{step.status}</em>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}

function CurriculumCard({
  curriculum,
  isSelected,
  onSelect,
}: {
  curriculum: Curriculum;
  isSelected: boolean;
  onSelect: (curriculumId: CurriculumId) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={isSelected}
      className={`curriculum-card ${isSelected ? "curriculum-card-selected" : ""}`}
      onClick={() => onSelect(curriculum.id)}
    >
      <span>{curriculum.pace}</span>
      <strong>{curriculum.title}</strong>
      <p>{curriculum.description}</p>
      <em>{curriculum.recommendedFor.join(" · ")}</em>
    </button>
  );
}

function LessonRow({ item, index }: { item: LessonItem; index: number }) {
  return (
    <article className="lesson-item">
      <div className="lesson-index">{index + 1}</div>
      <div>
        <div className="lesson-meta">
          <span>{kindLabels[item.kind]}</span>
          <span>{item.estimatedMinutes}분</span>
          <span>{item.required ? "필수" : "선택"}</span>
        </div>
        <h3>{item.title}</h3>
        <p>{item.description}</p>
        <div className="tag-row">
          {item.conceptTags.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      </div>
      <strong>{item.reason}</strong>
    </article>
  );
}
