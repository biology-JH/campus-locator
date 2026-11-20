import { describe, expect, it } from "vitest";
import { normalizeKnownTimetableText } from "./timetable.js";

describe("normalizeKnownTimetableText", () => {
  it.each([
    ["Uni cor n3", "Unicorn3"],
    ["Uni cor n3 S S Y", "Unicorn3 S S Y"],
    ["Uni cor n1 B D", "Unicorn1 B D"],
    ["uni  cor   n5 A K", "Unicorn5 A K"],
    ["12 BIO", "12 BIO"],
  ])("normalizes known timetable text %s without changing unrelated suffixes", (input, expected) => {
    expect(normalizeKnownTimetableText(input)).toBe(expected);
  });

  it("preserves null values", () => {
    expect(normalizeKnownTimetableText(null)).toBeNull();
  });
});
