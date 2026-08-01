import type { DemoStep } from "./demo-flow.types";

const DEMO_STORAGE_KEY = "ai-homeroom-teacher.demo-state.v1";

const validDemoSteps = new Set<DemoStep>([
  "intro",
  "curriculum",
  "today",
  "request",
  "reason",
  "learning-check",
  "next-session",
  "curriculum-map",
]);

export type DemoStorageState = {
  currentDemoStep: DemoStep;
};

export function readDemoStorageState(): Partial<DemoStorageState> | null {
  if (!isLocalStorageAvailable()) {
    return null;
  }

  try {
    const rawValue = window.localStorage.getItem(DEMO_STORAGE_KEY);

    if (!rawValue) {
      return null;
    }

    const value: unknown = JSON.parse(rawValue);

    if (!isRecord(value)) {
      return null;
    }

    const currentDemoStep = normalizeDemoStep(value.currentDemoStep);
    return currentDemoStep ? { currentDemoStep } : null;
  } catch {
    return null;
  }
}

export function saveDemoStorageState(state: DemoStorageState) {
  if (!isLocalStorageAvailable()) {
    return;
  }

  try {
    window.localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 화면 단계 저장 실패가 서버 기반 학습 흐름을 막지는 않습니다.
  }
}

function normalizeDemoStep(value: unknown): DemoStep | null {
  return typeof value === "string" && validDemoSteps.has(value as DemoStep)
    ? (value as DemoStep)
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isLocalStorageAvailable() {
  return typeof window !== "undefined" && "localStorage" in window;
}
