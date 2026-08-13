import type { ProgressService } from "./progress.types.js";
import { createMemoryProgressStateRepository } from "./progress.memory-repository.js";
import { createRepositoryProgressService } from "./progress.postgres-service.js";

export function createMemoryProgressService(): ProgressService {
  return createRepositoryProgressService(createMemoryProgressStateRepository());
}
