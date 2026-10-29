import { describe, expect, it } from "vitest";
import { scheduleSlotForDate, WeekAnchorNotConfiguredError } from "./school-week.js";

const anchor = { monday: "2026-08-17", week: "A" as const };

describe("school Week A/B date mapping", () => {
  it("maps Monday–Friday in the anchor week to the verified timetable week", () => {
    expect(scheduleSlotForDate("2026-08-17", "lesson1", anchor)).toMatchObject({
      weekMonday: "2026-08-17",
      scheduleWeek: "A",
      weekday: "Monday",
      period: "lesson1",
    });
    expect(scheduleSlotForDate("2026-08-21", "lesson7", anchor)).toMatchObject({
      weekMonday: "2026-08-17",
      scheduleWeek: "A",
      weekday: "Friday",
    });
  });

  it("alternates each complete Monday-starting week, including across month/year boundaries", () => {
    expect(scheduleSlotForDate("2026-08-24", "lesson1", anchor).scheduleWeek).toBe("B");
    expect(scheduleSlotForDate("2026-08-31", "lesson1", anchor).scheduleWeek).toBe("A");
    expect(scheduleSlotForDate("2027-01-04", "lesson1", anchor).scheduleWeek)
      .toBe(scheduleSlotForDate("2026-08-17", "lesson1", anchor).scheduleWeek);
  });

  it("maps dates before the anchor using the same alternating cycle", () => {
    expect(scheduleSlotForDate("2026-08-10", "lesson1", anchor).scheduleWeek).toBe("B");
  });

  it("matches the confirmed 2026–27 reset and reference weeks", () => {
    expect(scheduleSlotForDate("2026-10-26", "lesson1").scheduleWeek).toBe("A");
    expect(scheduleSlotForDate("2027-01-04", "lesson1").scheduleWeek).toBe("A");
    expect(scheduleSlotForDate("2027-02-08", "lesson1").scheduleWeek).toBe("B");
    expect(scheduleSlotForDate("2027-04-05", "lesson1").scheduleWeek).toBe("B");
    expect(scheduleSlotForDate("2027-06-07", "lesson1").scheduleWeek).toBe("A");
    expect(() => scheduleSlotForDate("2027-01-03", "lesson1")).toThrow(/Monday through Friday/);
  });

  it("rejects weekend dates and malformed or impossible calendar dates", () => {
    expect(() => scheduleSlotForDate("2026-08-22", "lesson1", anchor)).toThrow(/Monday through Friday/);
    expect(() => scheduleSlotForDate("2026-02-30", "lesson1", anchor)).toThrow(/real calendar date/);
    expect(() => scheduleSlotForDate("17/08/2026", "lesson1", anchor)).toThrow(/YYYY-MM-DD/);
  });

  it("requires a verified Monday anchor and does not guess when none is configured", () => {
    expect(() => scheduleSlotForDate("2026-08-17", "lesson1", null)).toThrow(WeekAnchorNotConfiguredError);
    expect(() => scheduleSlotForDate("2026-08-18", "lesson1", { monday: "2026-08-18", week: "A" }))
      .toThrow(/must be a Monday/);
  });
});
