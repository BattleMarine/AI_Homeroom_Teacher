import { analyzeLearningCheck as analyzeLearningCheckByRules } from "./learning-check.rules";
import type {
  LearningCheckAnalysis,
  LearningCheckAnalysisInput,
} from "./learning-check.types";

export function analyzeLearningCheck(
  input: LearningCheckAnalysisInput,
): LearningCheckAnalysis {
  return analyzeLearningCheckByRules(input);
}
