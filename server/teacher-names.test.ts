import { describe, expect, it } from "vitest";
import {
  capitalizeBracketedNames,
  isExcludedTeacherCode,
  isExcludedTeacherName,
} from "../shared/teacher-names.js";
import teacherAbbreviations from "./data/teacher-abbreviations.json" with { type: "json" };

describe("teacher name normalization", () => {
  it("capitalizes the first letter in every bracketed name without changing other text", () => {
    expect(capitalizeBracketedNames("Kouaho (guy) Gueye; Xinyao (yoyo) Feng; Yang (rick) Wang"))
      .toBe("Kouaho (Guy) Gueye; Xinyao (Yoyo) Feng; Yang (Rick) Wang");
    expect(capitalizeBracketedNames("Staff (école) Name"))
      .toBe("Staff (École) Name");
  });

  it("preserves nullish values for unoccupied timetable slots", () => {
    expect(capitalizeBracketedNames(null)).toBeNull();
    expect(capitalizeBracketedNames(undefined)).toBeUndefined();
  });

  it("recognizes requested names and the canonical source spellings", () => {
    for (const name of [
      "Greg Morrison",
      "Gregg Morrison",
      "Sam Sze Yin Hung",
      "Sze Yin Hung",
      "Yin Hung Sze",
      "Paul Lo",
      "Robert Kitney",
      "Robert Kitley",
    ]) {
      expect(isExcludedTeacherName(name), name).toBe(true);
    }
    expect(isExcludedTeacherName("Sam Lingwood")).toBe(false);
    expect(["GM", "YS", "RK", "PL"].every(isExcludedTeacherCode)).toBe(true);
    expect(teacherAbbreviations.staff.some(person => person.displayName === "Paul Lo")).toBe(false);
    expect(teacherAbbreviations.byCode).not.toHaveProperty("PL");
    expect(isExcludedTeacherCode("KG")).toBe(false);
  });
});
