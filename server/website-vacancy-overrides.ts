import type { PeriodId } from "../shared/timetable.js";

export type ScheduleSlotCoordinates = {
  week: string;
  day: string;
  period: PeriodId;
  roomNumber: string;
  staffCodes: string | null;
};

/**
 * Website-only vacancy overlay for the requested Woo Sik Byun slots.
 * It changes only API display results; database rows are never modified.
 */
export function isWebsiteOnlyVacancy({
  week,
  day,
  period,
  roomNumber,
  staffCodes,
}: ScheduleSlotCoordinates): boolean {
  if (week !== "B") return false;

  if (day === "Tuesday" && period === "lesson4" && roomNumber === "A802") {
    return true;
  }

  const requestedByunSlot =
    (day === "Wednesday" && period === "lesson6") ||
    (day === "Thursday" && period === "lesson3");
  if (!requestedByunSlot) return false;

  return (staffCodes ?? "")
    .split(",")
    .map(code => code.trim().toLocaleUpperCase())
    .includes("BW");
}
