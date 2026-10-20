import { describe, expect, it } from "vitest";
import { formatSubjectDisplay, SUBJECT_DICTIONARY_SUMMARY } from "./subject-resolution";

describe("subject display normalization", () => {
  it("expands the spaced Marine Science course code", () => {
    expect(formatSubjectDisplay("10 MA RS CI1 A")).toBe("10 Marine Science 1 A");
  });

  it("expands Science without changing teacher codes used by resolution", () => {
    expect(formatSubjectDisplay("07 SCI 6 BT")).toBe("07 Science 6 BT");
  });

  it("maps the paired Year 12 ESS source pattern to HL and SL", () => {
    expect(
      formatSubjectDisplay("12 SV ES C L3 C 12 SV ES C SS L3 C")
    ).toBe("12 ESS HL and SL");
  });

  it("expands spaced Integrated English codes for Years 10 and 8", () => {
    expect(formatSubjectDisplay("10 I E 2 G P")).toBe("10 Integrated English 2 G P");
    expect(formatSubjectDisplay("08 I E 4 A B")).toBe("08 Integrated English 4 A B");
  });

  it("uses the workbook's exact grade-specific full name when available", () => {
    expect(formatSubjectDisplay("12 ENG SL A")).toBe("12 English Language B IB SL A");
  });

  it("keeps unresolved strings intact", () => {
    expect(formatSubjectDisplay("Unparsed timetable text")).toBe("Unparsed timetable text");
  });

  it("loads the attached workbook-derived dictionary and requested aliases", () => {
    expect(SUBJECT_DICTIONARY_SUMMARY.sourceFile).toBe("backup.xlsx");
    expect(SUBJECT_DICTIONARY_SUMMARY.uniqueEntries).toBeGreaterThan(200);
    expect(SUBJECT_DICTIONARY_SUMMARY.aliases).toMatchObject({
      MA: "Mathematics",
      MATH: "Mathematics",
      SCI: "Science",
      ENG: "English",
      MARSCI: "Marine Science",
    });
  });
});
