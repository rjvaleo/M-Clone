import type { ProjectDocumentV2 } from "./document";

const clone = <T>(value: T): T => structuredClone(value);

/** Apply a saved startup screen while preserving fresh musical material. */
export function mergeStartupState(
  blank: ProjectDocumentV2,
  saved: ProjectDocumentV2,
): ProjectDocumentV2 {
  const merged = clone(saved);
  merged.project.patterns = clone(blank.project.patterns);
  merged.positions.timeDistort = clone(blank.positions.timeDistort);
  return merged;
}
