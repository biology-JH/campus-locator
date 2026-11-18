import { describe, expect, it } from "vitest";
import { isWebsiteOnlyVacancy } from "./website-vacancy-overrides.js";

describe("website-only timetable vacancy overlay", () => {
  it("marks A802 Tuesday Week B Period 4 vacant", () => {
    expect(isWebsiteOnlyVacancy({
      week: "B",
      day: "Tuesday",
      period: "lesson4",
      roomNumber: "A802",
      staffCodes: "BW",
    })).toBe(true);
  });

  it.each([
    { day: "Wednesday", period: "lesson6" as const },
    { day: "Thursday", period: "lesson3" as const },
  ])("marks Woo Sik Byun's Week B $day $period room vacant", ({ day, period }) => {
    expect(isWebsiteOnlyVacancy({
      week: "B",
      day,
      period,
      roomNumber: "A803",
      staffCodes: "AB,BW",
    })).toBe(true);
  });

  it("does not hide unrelated days, periods, weeks, or staff", () => {
    const base = {
      week: "B",
      day: "Wednesday",
      period: "lesson6" as const,
      roomNumber: "A803",
      staffCodes: "AB",
    };
    expect(isWebsiteOnlyVacancy(base)).toBe(false);
    expect(isWebsiteOnlyVacancy({ ...base, week: "A" })).toBe(false);
    expect(isWebsiteOnlyVacancy({ ...base, period: "lesson5" })).toBe(false);
    expect(isWebsiteOnlyVacancy({ ...base, day: "Monday" })).toBe(false);
    expect(isWebsiteOnlyVacancy({ ...base, day: "Tuesday", period: "lesson4" })).toBe(false);
    expect(isWebsiteOnlyVacancy({ ...base, roomNumber: "A803", day: "Tuesday", period: "lesson4", staffCodes: "AB" })).toBe(false);
  });
});
