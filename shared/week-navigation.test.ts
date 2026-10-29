import { describe, expect, it } from "vitest";
import { dateInCalendarWeek, scheduleSlotForDate } from "./school-week.js";

describe("booking calendar week navigation", () => {
  it("keeps the selected weekday when jumping to this week and next week", () => {
    const thisWeekWednesday = dateInCalendarWeek("2026-10-29", 0, "2026-10-28");
    const nextWeekWednesday = dateInCalendarWeek("2026-10-29", 1, "2026-10-28");

    expect(thisWeekWednesday).toBe("2026-10-28");
    expect(nextWeekWednesday).toBe("2026-11-04");
    expect(scheduleSlotForDate(thisWeekWednesday, "lesson1").scheduleWeek).toBe("A");
    expect(scheduleSlotForDate(nextWeekWednesday, "lesson1").scheduleWeek).toBe("B");
  });

  it("falls back to Monday when the preferred date is a weekend", () => {
    const thisWeekMonday = dateInCalendarWeek("2027-06-01", 0, "2027-06-05");
    expect(thisWeekMonday).toBe("2027-05-31");
    expect(scheduleSlotForDate(thisWeekMonday, "lesson1").scheduleWeek).toBe("B");
  });

  it("keeps future navigation aligned with the June skip and reset", () => {
    const skippedWeekTuesday = dateInCalendarWeek("2027-06-01", 1, "2027-06-01");
    expect(skippedWeekTuesday).toBe("2027-06-08");
    expect(() => scheduleSlotForDate(skippedWeekTuesday, "lesson1")).toThrow(/week beginning 2027-06-07 is skipped/);

    const resetWeekMonday = dateInCalendarWeek("2027-06-14", 0, "2027-06-14");
    expect(resetWeekMonday).toBe("2027-06-14");
    expect(scheduleSlotForDate(resetWeekMonday, "lesson1").scheduleWeek).toBe("A");
  });

  it("rejects fractional week offsets", () => {
    expect(() => dateInCalendarWeek("2026-10-29", 0.5)).toThrow(/whole number/);
  });
});
