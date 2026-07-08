import { useEffect, useMemo, useState } from "react";
import {
  getCurriculumMap,
  getCurriculums,
  type Curriculum,
  type CurriculumId,
} from "../features/curriculum";
import {
  analyzeLearningCheck,
  type LearningCheckLevel,
  type LearningCheckSubmission,
  type LearningRecommendation,
} from "../features/learning-check";
import {
  applyStudentRequestToProgress,
  generateNextSession,
  generateTodaySession,
  type StudentRequestKind,
} from "../features/progress-orchestrator";
import {
  createDemoLearningCheckSubmission,
  createDemoSessionData,
} from "../mock/demo-session.data";
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

const studentRequestOptions: Array<{
  kind: StudentRequestKind;
  label: string;
  description: string;
}> = [
  {
    kind: "default",
    label: "기본 편성",
    description: "현재 진도와 취약 개념을 기준으로 편성합니다.",
  },
  {
    kind: "short_time",
    label: "오늘 시간이 부족해요",
    description: "핵심 보강과 필수 확인만 남깁니다.",
  },
  {
    kind: "review_first",
    label: "복습 위주",
    description: "새 진도보다 헷갈린 개념을 먼저 안정시킵니다.",
  },
  {
    kind: "confused_concept",
    label: "특정 개념이 헷갈려요",
    description: "현재 단계 개념 하나를 보강 흐름에 반영합니다.",
  },
  {
    kind: "reduce_new_lecture",
    label: "새 강의 줄이기",
    description: "새 강의 비중을 줄이고 확인 중심으로 조정합니다.",
  },
];

export function App() {
  const [selectedCurriculumId, setSelectedCurriculumId] =
    useState<CurriculumId>("stable-log");
  const [learningCheckSubmission, setLearningCheckSubmission] =
    useState<LearningCheckSubmission>(
      () => createDemoSessionData("stable-log").demoLearningCheckSubmission,
    );
  const [studentRequestKind, setStudentRequestKind] =
    useState<StudentRequestKind>("default");
  const { demoCurriculum, demoStudentState } = useMemo(
    () => createDemoSessionData(selectedCurriculumId),
    [selectedCurriculumId],
  );
  const currentStepConcepts = useMemo(
    () =>
      demoCurriculum.steps.find((step) => step.id === demoStudentState.currentStepId)
        ?.conceptTags ?? [],
    [demoCurriculum.steps, demoStudentState.currentStepId],
  );
  const studentRequestAdjustment = useMemo(
    () =>
      applyStudentRequestToProgress({
        studentState: demoStudentState,
        requestKind: studentRequestKind,
        focusConcept: demoStudentState.weakConcepts[0],
        currentStepConcepts,
      }),
    [currentStepConcepts, demoStudentState, studentRequestKind],
  );
  const adjustedStudentState = studentRequestAdjustment.adjustedStudentState;
  const demoTodaySession = useMemo(
    () =>
      generateTodaySession({
        studentState: adjustedStudentState,
        maxMinutes: studentRequestAdjustment.maxMinutes,
      }),
    [adjustedStudentState, studentRequestAdjustment.maxMinutes],
  );
  const demoCurriculumSteps = useMemo(
    () =>
      getCurriculumMap(demoCurriculum, {
        currentStepId: adjustedStudentState.currentStepId,
        completedStepIds: adjustedStudentState.completedStepIds,
        delayedStepIds: adjustedStudentState.delayedStepIds,
        weakConcepts: adjustedStudentState.weakConcepts,
      }),
    [adjustedStudentState, demoCurriculum],
  );
  const defaultLearningCheckSubmission = useMemo(
    () =>
      createDemoLearningCheckSubmission(
        demoTodaySession,
        adjustedStudentState.weakConcepts.slice(0, 1),
      ),
    [adjustedStudentState.weakConcepts, demoTodaySession],
  );
  useEffect(() => {
    setLearningCheckSubmission(defaultLearningCheckSubmission);
  }, [defaultLearningCheckSubmission]);
  const demoLearningCheckAnalysis = useMemo(
    () =>
      analyzeLearningCheck({
        submission: learningCheckSubmission,
        todaySession: demoTodaySession,
      }),
    [learningCheckSubmission, demoTodaySession],
  );
  const demoNextSession = useMemo(
    () =>
      generateNextSession({
        studentState: adjustedStudentState,
        todaySession: demoTodaySession,
        learningAnalysis: demoLearningCheckAnalysis,
      }),
    [adjustedStudentState, demoLearningCheckAnalysis, demoTodaySession],
  );
  const conceptOptions = useMemo(
    () =>
      [
        ...new Set([
          ...adjustedStudentState.weakConcepts,
          ...demoTodaySession.items.flatMap((item) => item.conceptTags),
        ]),
      ],
    [adjustedStudentState.weakConcepts, demoTodaySession.items],
  );
  const progressPercent = Math.round(
    (adjustedStudentState.completedStepCount / adjustedStudentState.totalStepCount) *
      100,
  );
  const problemAccuracyPercent =
    demoLearningCheckAnalysis.problemAccuracy === null
      ? null
      : Math.round(demoLearningCheckAnalysis.problemAccuracy * 100);

  function handleSelectCurriculum(curriculumId: CurriculumId) {
    setSelectedCurriculumId(curriculumId);
    setStudentRequestKind("default");
  }

  function updateLearningLevel(
    field: "understandingLevel" | "focusLevel",
    value: string,
  ) {
    setLearningCheckSubmission((currentSubmission) => ({
      ...currentSubmission,
      [field]: Number(value) as LearningCheckLevel,
    }));
  }

  function updateProblemCorrectCount(value: string) {
    const parsedValue = Number(value);
    const safeValue = Number.isFinite(parsedValue) ? parsedValue : 0;
    const nextCorrectCount = Math.min(
      Math.max(safeValue, 0),
      learningCheckSubmission.problemResult.totalCount,
    );

    setLearningCheckSubmission((currentSubmission) => ({
      ...currentSubmission,
      problemResult: {
        ...currentSubmission.problemResult,
        correctCount: nextCorrectCount,
      },
    }));
  }

  function updateProblemTotalCount(value: string) {
    const parsedValue = Number(value);
    const safeValue = Number.isFinite(parsedValue) ? parsedValue : 0;
    const nextTotalCount = Math.max(safeValue, 0);

    setLearningCheckSubmission((currentSubmission) => ({
      ...currentSubmission,
      problemResult: {
        correctCount: Math.min(
          currentSubmission.problemResult.correctCount,
          nextTotalCount,
        ),
        totalCount: nextTotalCount,
      },
    }));
  }

  function toggleConfusedConcept(concept: string) {
    setLearningCheckSubmission((currentSubmission) => {
      const hasConcept = currentSubmission.confusedConcepts.includes(concept);
      const confusedConcepts = hasConcept
        ? currentSubmission.confusedConcepts.filter((item) => item !== concept)
        : [...currentSubmission.confusedConcepts, concept];

      return {
        ...currentSubmission,
        confusedConcepts,
      };
    });
  }

  function toggleCompletedItem(itemId: string) {
    setLearningCheckSubmission((currentSubmission) => {
      const completedItemIds = currentSubmission.completedItemIds.includes(itemId)
        ? currentSubmission.completedItemIds.filter((id) => id !== itemId)
        : [...currentSubmission.completedItemIds, itemId];
      const skippedItemIds = demoTodaySession.items
        .filter((item) => !completedItemIds.includes(item.id))
        .map((item) => item.id);

      return {
        ...currentSubmission,
        completedItemIds,
        skippedItemIds,
      };
    });
  }

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
              <button
                type="button"
                className="secondary-button"
                onClick={() => setStudentRequestKind("short_time")}
              >
                오늘 시간이 부족해요
              </button>
              <button type="button" className="ghost-button">
                왜 이렇게 배정됐나요?
              </button>
            </div>
          </div>

          <aside className="status-panel" aria-label="현재 학습 상태">
            <div className="status-label">현재 커리큘럼</div>
            <strong>{adjustedStudentState.selectedCurriculumTitle}</strong>
            <span>{adjustedStudentState.currentStepTitle} 진행 중</span>
            <div className="progress-track" aria-label={`진도율 ${progressPercent}%`}>
              <div style={{ width: `${progressPercent}%` }} />
            </div>
            <span>
              {adjustedStudentState.completedStepCount}/{adjustedStudentState.totalStepCount}단계 완료
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
              onSelect={handleSelectCurriculum}
            />
          ))}
        </div>
      </section>

      <section className="student-request-panel" aria-labelledby="student-request-title">
        <div className="section-heading">
          <div>
            <span className="eyebrow">학생 요구사항 반영</span>
            <h2 id="student-request-title">오늘 상태에 맞게 수업량을 조정하세요</h2>
          </div>
        </div>

        <div className="request-card-list">
          {studentRequestOptions.map((requestOption) => (
            <button
              type="button"
              aria-pressed={studentRequestKind === requestOption.kind}
              className={`request-card ${
                studentRequestKind === requestOption.kind ? "request-card-selected" : ""
              }`}
              key={requestOption.kind}
              onClick={() => setStudentRequestKind(requestOption.kind)}
            >
              <strong>{requestOption.label}</strong>
              <span>{requestOption.description}</span>
            </button>
          ))}
        </div>

        <p className="request-note">
          <strong>{studentRequestAdjustment.summary}</strong>
          {studentRequestAdjustment.teacherNote}
        </p>
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
              {adjustedStudentState.weakConcepts.map((concept) => (
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
              <h2 id="learning-check-title">오늘 결과를 입력하세요</h2>
            </div>
          </div>

          <div className="check-form" aria-label="학습 후 체크 입력">
            <label className="field-group">
              <span>이해도</span>
              <div className="range-row">
                <input
                  type="range"
                  min="1"
                  max="5"
                  value={learningCheckSubmission.understandingLevel}
                  onChange={(event) =>
                    updateLearningLevel("understandingLevel", event.target.value)
                  }
                />
                <strong>{learningCheckSubmission.understandingLevel}/5</strong>
              </div>
            </label>

            <label className="field-group">
              <span>집중도</span>
              <div className="range-row">
                <input
                  type="range"
                  min="1"
                  max="5"
                  value={learningCheckSubmission.focusLevel}
                  onChange={(event) =>
                    updateLearningLevel("focusLevel", event.target.value)
                  }
                />
                <strong>{learningCheckSubmission.focusLevel}/5</strong>
              </div>
            </label>

            <div className="field-group">
              <span>확인 문제</span>
              <div className="problem-input-row">
                <label>
                  <input
                    type="number"
                    min="0"
                    max={learningCheckSubmission.problemResult.totalCount}
                    value={learningCheckSubmission.problemResult.correctCount}
                    onChange={(event) => updateProblemCorrectCount(event.target.value)}
                  />
                  <span>정답 수</span>
                </label>
                <label>
                  <input
                    type="number"
                    min="0"
                    value={learningCheckSubmission.problemResult.totalCount}
                    onChange={(event) => updateProblemTotalCount(event.target.value)}
                  />
                  <span>전체 문항</span>
                </label>
              </div>
            </div>

            <div className="field-group">
              <span>헷갈린 개념</span>
              <div className="checkbox-grid">
                {conceptOptions.map((concept) => (
                  <label className="check-chip" key={concept}>
                    <input
                      type="checkbox"
                      checked={learningCheckSubmission.confusedConcepts.includes(concept)}
                      onChange={() => toggleConfusedConcept(concept)}
                    />
                    <span>{concept}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="field-group">
              <span>완료한 항목</span>
              <div className="item-check-list">
                {demoTodaySession.items.map((item) => (
                  <label key={item.id}>
                    <input
                      type="checkbox"
                      checked={learningCheckSubmission.completedItemIds.includes(item.id)}
                      onChange={() => toggleCompletedItem(item.id)}
                    />
                    <span>{item.title}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <dl className="summary-list">
            <div>
              <dt>이해도</dt>
              <dd>{learningCheckSubmission.understandingLevel}/5</dd>
            </div>
            <div>
              <dt>집중도</dt>
              <dd>{learningCheckSubmission.focusLevel}/5</dd>
            </div>
            <div>
              <dt>확인 문제</dt>
              <dd>
                {learningCheckSubmission.problemResult.correctCount}/
                {learningCheckSubmission.problemResult.totalCount}개 정답
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
