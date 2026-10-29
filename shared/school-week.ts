import { DAYS, type Day, type PeriodId, type Week } from "./timetable.js";

/**
 * Calendar date and timetable week for the Monday-starting school cycle.
 * Set only after a Week A anchor is confirmed from the school calendar.
 */
export type SchoolWeekAnchor = {
  monday: string;
  week: Week;
};

/** The attachment had no A/B labels; the user confirmed 2027-01-04 as the Week A reset. */
export const SCHOOL_WEEK_CYCLE_ANCHOR: SchoolWeekAnchor = {
  monday: "2027-01-04",
  week: "A",
};

export class WeekAnchorNotConfiguredError extends Error {
  constructor() {
    super("The school Week A anchor has not been confirmed yet.");
    this.name = "WeekAnchorNotConfiguredError";
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

function parseDateOnly(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RangeError("Enter a valid calendar date in YYYY-MM-DD format.");
  }

  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(0);
  parsed.setUTCHours(0, 0, 0, 0);
  parsed.setUTCFullYear(year, month - 1, day);
  if (parsed.toISOString().slice(0, 10) !== value) {
    throw new RangeError("Enter a real calendar date.");
  }
  return parsed.getTime();
}

function mondayForDate(dateMs: number): number {
  const weekday = new Date(dateMs).getUTCDay();
  const daysSinceMonday = (weekday + 6) % 7;
  return dateMs - daysSinceMonday * DAY_MS;
}

function formatDateOnly(dateMs: number): string {
  return new Date(dateMs).toISOString().slice(0, 10);
}

/**
 * Convert a calendar date into the school's recurring Week A/B timetable slot.
 * The anchor describes the Monday-starting week containing a verified reference
 * date. Date-only UTC arithmetic avoids server/browser timezone and DST drift.
 */
export function scheduleSlotForDate(
  date: string,
  period: PeriodId,
  anchor: SchoolWeekAnchor | null = SCHOOL_WEEK_CYCLE_ANCHOR,
): { date: string; weekMonday: string; scheduleWeek: Week; weekday: Day; period: PeriodId } {
  if (!anchor) throw new WeekAnchorNotConfiguredError();

  const dateMs = parseDateOnly(date);
  const weekdayIndex = new Date(dateMs).getUTCDay();
  if (weekdayIndex === 0 || weekdayIndex === 6) {
    throw new RangeError("Bookings are available Monday through Friday only.");
  }

  const anchorMs = parseDateOnly(anchor.monday);
  if (new Date(anchorMs).getUTCDay() !== 1) {
    throw new RangeError("The Week A/B anchor must be a Monday.");
  }
  if (anchor.week !== "A" && anchor.week !== "B") {
    throw new RangeError("The school-week anchor must be Week A or Week B.");
  }

  const selectedMonday = mondayForDate(dateMs);
  const fullWeeksFromAnchor = Math.floor((selectedMonday - anchorMs) / WEEK_MS);
  const alternates = ((fullWeeksFromAnchor % 2) + 2) % 2 === 1;
  const scheduleWeek: Week = alternates ? (anchor.week === "A" ? "B" : "A") : anchor.week;

  return {
    date,
    weekMonday: formatDateOnly(selectedMonday),
    scheduleWeek,
    weekday: DAYS[weekdayIndex - 1],
    period,
  };
}
