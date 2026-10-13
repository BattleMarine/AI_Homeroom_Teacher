import { createHash } from "node:crypto";
import type { LearningPlanCatalogSelection } from "./learning-plan.types.js";

/** 객체 key 순서에 독립적이며 배열 순서는 의미 있게 보존한다. */
export function canonicalLearningPlanJson(value: unknown): string {
  const active = new Set<object>();
  function visit(node: unknown): string {
    if (node === null || typeof node === "boolean" || typeof node === "string") return JSON.stringify(node);
    if (typeof node === "number" && Number.isFinite(node)) return JSON.stringify(node);
    if (typeof node !== "object" || active.has(node)) throw new Error("유효한 JSON 값이 필요합니다.");
    active.add(node);
    try {
      if (Array.isArray(node)) {
        for (let index = 0; index < node.length; index += 1) {
          if (!Object.hasOwn(node, index)) throw new Error("희소 배열은 JSON 입력으로 허용하지 않습니다.");
        }
        return `[${node.map(visit).join(",")}]`;
      }
      if (Object.getPrototypeOf(node) !== Object.prototype && Object.getPrototypeOf(node) !== null) {
        throw new Error("단순 JSON 객체만 허용합니다.");
      }
      return `{${Object.keys(node).sort().map((key) => `${JSON.stringify(key)}:${visit((node as Record<string, unknown>)[key])}`).join(",")}}`;
    } finally {
      active.delete(node);
    }
  }
  return visit(value);
}

export function learningPlanCatalogHash(snapshot: readonly LearningPlanCatalogSelection[]): string {
  const ordered = snapshot.map(({ subjectCode, catalog }) => ({
    subjectCode, catalog: { course: catalog.course, lessons: [...catalog.lessons].sort((a, b) => a.sequence - b.sequence) },
  })).sort((a, b) => compare(a.catalog.course.id, b.catalog.course.id) || compare(a.subjectCode, b.subjectCode));
  return createHash("sha256").update(canonicalLearningPlanJson(ordered)).digest("hex");
}

function compare(a: string, b: string) { return a < b ? -1 : a > b ? 1 : 0; }
