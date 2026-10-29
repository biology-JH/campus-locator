import { DAYS, type Day, type PeriodId, type Week } from "./timetable.js";

export type SchoolWeekAnchor = {
  monday: string;
  week: Week;
};

/** School-confirmed Monday reset points for the 2026–27 booking cycle. */
export const SCHOOL_WEEK_CYCLE_ANCHORS: readonly SchoolWeekAnchor[] = [
  { monday: "2027-01-04", week: "A" },
  { monday: "2027-04-12", week: "A" },
  { monday: "2027-06-14", week: "A" },
];

/** The school week beginning Monday 2027-06-07 is skipped and cannot be booked. */
export const SCHOOL_WEEK_SKIPPED_MONDAYS = Object.freeze(["2027-06-07"] as const);
const skippedWeekStarts = new Set<string>(SCHOOL_WEEK_SKIPPED_MONDAYS);

export class WeekAnchorNotConfiguredError extends Error {
  constructor() {
    super("No school Week A/B cycle anchor is configured.");
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

function normalizeAnchors(
  anchorOrAnchors: SchoolWeekAnchor | readonly SchoolWeekAnchor[] | null,
): Array<SchoolWeekAnchor & { mondayMs: number }> {
  if (anchorOrAnchors === null) throw new WeekAnchorNotConfiguredError();
  const anchors: readonly SchoolWeekAnchor[] = Array.isArray(anchorOrAnchors)
    ? anchorOrAnchors
    : [anchorOrAnchors as SchoolWeekAnchor];
  if (anchors.length === 0) throw new WeekAnchorNotConfiguredError();

  const normalized = anchors.map(anchor => {
    const mondayMs = parseDateOnly(anchor.monday);
    if (new Date(mondayMs).getUTCDay() !== 1) {
      throw new RangeError("The Week A/B reset anchor must be a Monday.");
    }
    if (anchor.week !== "A" && anchor.week !== "B") {
      throw new RangeError("The school-week anchor must be Week A or Week B.");
    }
    return { ...anchor, mondayMs };
  }).sort((left, right) => left.mondayMs - right.mondayMs);

  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index - 1]?.mondayMs === normalized[index]?.mondayMs) {
      throw new RangeError("School-week reset anchors must use different Mondays.");
    }
  }

  return normalized;
}

/**
 * Convert a Monday–Friday calendar date into the school's recurring Week A/B
 * timetable slot. Explicit school reset anchors override the previous cycle.
 * Calendar dates are parsed in UTC so local timezone/DST cannot shift the week.
 */
export function scheduleSlotForDate(
  date: string,
  period: PeriodId,
  anchorOrAnchors: SchoolWeekAnchor | readonly SchoolWeekAnchor[] | null = SCHOOL_WEEK_CYCLE_ANCHORS,
): { date: string; weekMonday: string; scheduleWeek: Week; weekday: Day; period: PeriodId } {
  const dateMs = parseDateOnly(date);
  const weekdayIndex = new Date(dateMs).getUTCDay();
  if (weekdayIndex === 0 || weekdayIndex === 6) {
    throw new RangeError("Bookings are available Monday through Friday only.");
  }

  const selectedMonday = mondayForDate(dateMs);
  const weekMonday = formatDateOnly(selectedMonday);
  if (skippedWeekStarts.has(weekMonday)) {
    throw new RangeError(`The school week beginning ${weekMonday} is skipped; room bookings are closed for this week.`);
  }

  const anchors = normalizeAnchors(anchorOrAnchors);
  let activeAnchor = anchors[0];
  for (const candidate of anchors) {
    if (candidate.mondayMs <= selectedMonday) activeAnchor = candidate;
    else break;
  }
  if (!activeAnchor) throw new WeekAnchorNotConfiguredError();

  const fullWeeksFromAnchor = Math.floor((selectedMonday - activeAnchor.mondayMs) / WEEK_MS);
  const alternates = ((fullWeeksFromAnchor % 2) + 2) % 2 === 1;
  const scheduleWeek: Week = alternates ? (activeAnchor.week === "A" ? "B" : "A") : activeAnchor.week;

  return {
    date,
    weekMonday,
    scheduleWeek,
    weekday: DAYS[weekdayIndex - 1],
    period,
  };
}
