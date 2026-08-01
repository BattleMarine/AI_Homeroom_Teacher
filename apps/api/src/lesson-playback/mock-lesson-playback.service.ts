import { readFileSync } from "node:fs";

const mockPlaybackAssets = {
  "mock-logarithm-lecture": {
    fileUrl: new URL("../../assets/mock-logarithm-lecture.png", import.meta.url),
  },
} as const;

export function readMockLessonPlaybackAsset(assetKey: string): Buffer | undefined {
  const asset = mockPlaybackAssets[assetKey as keyof typeof mockPlaybackAssets];

  if (!asset) return undefined;

  return readFileSync(asset.fileUrl);
}