import { describe, expect, it } from "vitest";
import { stageBatchAssignment, validateBatchDraft } from "./batch-schedule";

describe("validateBatchDraft and dropdown staging", () => {
  it("marks duplicate room assignments during intermediate dropdown changes", () => {
    const rooms = ["A", "B", "C"];
    let draft: Record<string, string> = { A: "A", B: "B", C: "C" };
    draft = stageBatchAssignment(draft, "A", "B");
    const result = validateBatchDraft(rooms, draft);
    expect(result.ready).toBe(true);
    expect(result.hasConflicts).toBe(true);
    expect(result.hasChanges).toBe(true);
    expect(result.conflictRows).toEqual(new Set(["A", "B"]));
  });

  it("stages a 3-way room rotation sequentially and enables saving only when the full cycle resolves", () => {
    const rooms = ["A", "B", "C"];
    let draft: Record<string, string> = { A: "A", B: "B", C: "C" };
    for (const [target, source] of [["A", "B"], ["B", "C"]]) {
      draft = stageBatchAssignment(draft, target, source);
      expect(validateBatchDraft(rooms, draft).hasConflicts).toBe(true);
    }
    draft = stageBatchAssignment(draft, "C", "A");
    const result = validateBatchDraft(rooms, draft);
    expect(result.hasConflicts).toBe(false);
    expect(result.hasChanges).toBe(true);
    expect(result.conflictRows.size).toBe(0);
  });

  it("stages a 4-way room rotation sequentially and enables saving only when the full cycle resolves", () => {
    const rooms = ["A", "B", "C", "D"];
    let draft: Record<string, string> = { A: "A", B: "B", C: "C", D: "D" };
    for (const [target, source] of [["A", "B"], ["B", "C"], ["C", "D"]]) {
      draft = stageBatchAssignment(draft, target, source);
      expect(validateBatchDraft(rooms, draft).hasConflicts).toBe(true);
    }
    draft = stageBatchAssignment(draft, "D", "A");
    const result = validateBatchDraft(rooms, draft);
    expect(result.hasConflicts).toBe(false);
    expect(result.hasChanges).toBe(true);
    expect(result.conflictRows.size).toBe(0);
  });

  it("marks incomplete drafts as conflicts and disables saving", () => {
    const result = validateBatchDraft(["A", "B", "C"], { A: "A", B: "B" });
    expect(result.ready).toBe(false);
    expect(result.hasConflicts).toBe(true);
    expect(result.hasChanges).toBe(false);
    expect(result.conflictRows).toEqual(new Set(["C"]));
  });
});
