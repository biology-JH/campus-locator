import { createHash } from "node:crypto";
import express, { type RequestHandler } from "express";
import { asc, eq, inArray } from "drizzle-orm";
import * as XLSX from "xlsx";
import { bookings, classrooms } from "../drizzle/schema.js";
import { DAYS, EXCLUDED_ROOM_NUMBERS, PERIODS, type Day, type PeriodId, type Week } from "../shared/timetable.js";
import { SCHOOL_WEEK_CYCLE_ANCHORS, scheduleSlotForDate } from "../shared/school-week.js";
import { capitalizeBracketedNames } from "../shared/teacher-names.js";
import { getDb } from "./db.js";
import { ensureBookingsSchema } from "./bookings-schema.js";
import { publicTeacherNames } from "./timetable.js";
import { createAdminBookingSnapshotToken, verifyAdminBookingSnapshotToken } from "./_core/admin-session.js";

const ADMIN_PATH = "/api/admin/bookings";
const MAX_CSV_FILE_BYTES = 5 * 1024 * 1024;
const MAX_CSV_ROWS = 10_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const CSV_CONTENT_TYPES = ["text/csv", "application/vnd.ms-excel", "application/octet-stream"];
const roomSlotPeriodLabel = new Map<PeriodId, string>(PERIODS.map(period => [period.id, period.label]));
const excludedRooms = new Set<string>(EXCLUDED_ROOM_NUMBERS);

type BookingDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type BookingReader = Pick<BookingDb, "select">;
export type BookingRow = {
  id: number;
  roomId: number;
  roomNumber: string;
  teacherId: string;
  teacherName: string;
  scheduleWeek: Week;
  weekday: Day;
  classPeriod: PeriodId;
  createdAt: Date;
};
export type ParsedBookingSnapshotRow = {
  date: string;
  period: PeriodId;
  periodCell: string;
  roomNumber: string;
  roomCell: string;
  teacherName: string;
  teacherCell: string;
  roomId: number;
  teacherId: string;
  scheduleWeek: Week;
  weekday: Day;
  recordKey: string;
};

export type SnapshotPlan = {
  currentCount: number;
  retainedCount: number;
  cancelledIds: number[];
};

class StaleBookingSnapshotError extends Error {
  constructor() {
    super("Bookings changed after this CSV was downloaded. Download a fresh Master Schedule CSV and retry.");
    this.name = "StaleBookingSnapshotError";
  }
}

function databaseErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = error as { code?: unknown; cause?: unknown };
  if (typeof value.code === "string") return value.code;
  if (value.cause && typeof value.cause === "object" && typeof (value.cause as { code?: unknown }).code === "string") {
    return (value.cause as { code: string }).code;
  }
  return undefined;
}

function bookingRecordKey(row: Pick<BookingRow, "roomId" | "scheduleWeek" | "weekday" | "classPeriod" | "teacherId">): string {
  return [row.roomId, row.scheduleWeek, row.weekday, row.classPeriod, row.teacherId].join("\u001f");
}

export function bookingSnapshotHash(rows: readonly Pick<BookingRow, "id" | "roomId" | "roomNumber" | "teacherName" | "scheduleWeek" | "weekday" | "classPeriod" | "teacherId">[]): string {
  const canonical = rows
    .map(row => ({ id: row.id, key: bookingRecordKey(row), roomNumber: row.roomNumber, teacherName: row.teacherName }))
    .sort((left, right) => left.id - right.id);
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function dateOnlyMilliseconds(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError("Date must use YYYY-MM-DD format.");
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  if (date.toISOString().slice(0, 10) !== value) throw new RangeError("Date must be a real calendar date.");
  return date.getTime();
}

function formatDateOnly(milliseconds: number): string {
  return new Date(milliseconds).toISOString().slice(0, 10);
}

function dateInHongKong(at: Date | number = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at instanceof Date ? at : new Date(at));
  const part = (type: "year" | "month" | "day") => parts.find(value => value.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function todayInHongKong(): string {
  return dateInHongKong(new Date());
}

export function nextOccurrenceDate(targetWeek: Week, targetDay: Day, fromDate = todayInHongKong()): string {
  const fromMilliseconds = dateOnlyMilliseconds(fromDate);
  const weekdayIndex = new Date(fromMilliseconds).getUTCDay();
  const mondayOffset = (weekdayIndex + 6) % 7;
  const mondayMilliseconds = fromMilliseconds - mondayOffset * DAY_MS;
  const dayOffset = DAYS.indexOf(targetDay);

  for (let weekOffset = 0; weekOffset <= 520; weekOffset += 1) {
    const candidate = formatDateOnly(mondayMilliseconds + (weekOffset * 7 + dayOffset) * DAY_MS);
    if (candidate < fromDate) continue;
    try {
      const slot = scheduleSlotForDate(candidate, "mentor", SCHOOL_WEEK_CYCLE_ANCHORS);
      if (slot.scheduleWeek === targetWeek) return candidate;
    } catch (error) {
      if (error instanceof RangeError) continue;
      throw error;
    }
  }
  throw new RangeError("Could not find the next matching school-week occurrence.");
}

function normalizedTeacherKey(value: string): string {
  return capitalizeBracketedNames(value.trim()).toLocaleLowerCase("en");
}

function parseCsvDate(value: unknown): string {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10);
  const date = String(value ?? "").trim();
  if (typeof value === "number" && Number.isFinite(value)) {
    const parts = XLSX.SSF.parse_date_code(value);
    if (!parts || !parts.y || !parts.m || !parts.d) throw new RangeError("Date must be a valid Excel calendar date.");
    const iso = `${String(parts.y).padStart(4, "0")}-${String(parts.m).padStart(2, "0")}-${String(parts.d).padStart(2, "0")}`;
    dateOnlyMilliseconds(iso);
    return iso;
  }
  const yearFirst = date.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (yearFirst) {
    const iso = `${yearFirst[1]}-${yearFirst[2]!.padStart(2, "0")}-${yearFirst[3]!.padStart(2, "0")}`;
    dateOnlyMilliseconds(iso);
    return iso;
  }
  const localized = date.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/);
  if (!localized) throw new RangeError("Date must use YYYY-MM-DD or an unambiguous localized calendar date.");
  const first = Number(localized[1]);
  const second = Number(localized[2]);
  if (first <= 12 && second <= 12) throw new RangeError("Date is ambiguous. Keep it in YYYY-MM-DD format before uploading.");
  const month = first > 12 ? second : first;
  const day = first > 12 ? first : second;
  const yearValue = Number(localized[3]);
  const year = yearValue < 100 ? 2000 + yearValue : yearValue;
  const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  dateOnlyMilliseconds(iso);
  return iso;
}

function parseCsvPeriod(value: unknown): PeriodId {
  const period = String(value ?? "").trim().toLocaleLowerCase("en");
  const match = PERIODS.find(item => item.id.toLocaleLowerCase("en") === period
    || item.label.toLocaleLowerCase("en") === period);
  if (!match) throw new RangeError("Period must match a listed schedule period.");
  return match.id;
}

function cellText(value: unknown): string {
  return String(value ?? "").trim();
}

export function parseBookingCsvSnapshot(
  buffer: Buffer,
  roomIdsByNumber: ReadonlyMap<string, number>,
  canonicalTeachers: ReadonlyMap<string, string> = new Map(publicTeacherNames().map(name => [normalizedTeacherKey(name), name])),
): ParsedBookingSnapshotRow[] {
  if (buffer.length === 0) throw new RangeError("The CSV file is empty.");
  const workbook = XLSX.read(buffer, { type: "buffer", raw: false });
  if (workbook.SheetNames.length !== 1) throw new RangeError("Upload one CSV sheet only.");
  const sheet = workbook.Sheets[workbook.SheetNames[0] ?? ""];
  if (!sheet) throw new RangeError("The CSV file could not be read.");
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "", blankrows: false });
  if (rows.length === 0) throw new RangeError("The CSV header row is missing.");
  const headers = (rows[0] ?? []).map(cellText);
  if (headers.length !== 4 || headers.some((header, index) => header !== ["Date", "Period", "Room", "Teacher"][index])) {
    throw new RangeError("Use the exact CSV columns in this order: Date, Period, Room, Teacher.");
  }
  if (rows.length - 1 > MAX_CSV_ROWS) throw new RangeError(`The CSV may contain no more than ${MAX_CSV_ROWS} booking rows.`);

  const seen = new Set<string>();
  const parsed: ParsedBookingSnapshotRow[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    if (row.slice(4).some(value => cellText(value) !== "")) {
      throw new RangeError(`CSV row ${index + 1} has data outside the four supported columns.`);
    }
    const [dateValue, periodValue, roomValue, teacherValue] = row;
    if ([dateValue, periodValue, roomValue, teacherValue].every(value => cellText(value) === "")) continue;
    if ([dateValue, periodValue, roomValue, teacherValue].some(value => cellText(value) === "")) {
      throw new RangeError(`CSV row ${index + 1} is incomplete.`);
    }

    const date = parseCsvDate(dateValue);
    const periodCell = cellText(periodValue);
    const period = parseCsvPeriod(periodCell);
    const roomCell = cellText(roomValue);
    const roomNumber = roomCell.toLocaleUpperCase("en");
    const roomId = roomIdsByNumber.get(roomNumber);
    if (!roomId || excludedRooms.has(roomNumber)) throw new RangeError(`CSV row ${index + 1} contains an unknown or unavailable room.`);
    const teacherCell = cellText(teacherValue);
    const teacherInput = capitalizeBracketedNames(teacherCell);
    const teacherName = canonicalTeachers.get(normalizedTeacherKey(teacherInput));
    if (!teacherName) throw new RangeError(`CSV row ${index + 1} contains a teacher who is not on the current staff list.`);

    const slot = scheduleSlotForDate(date, period, SCHOOL_WEEK_CYCLE_ANCHORS);
    const teacherId = createHash("sha256").update(teacherName.trim().toLocaleLowerCase("en")).digest("hex").slice(0, 32);
    const record = {
      date,
      period,
      periodCell,
      roomNumber,
      roomCell,
      teacherName,
      teacherCell,
      roomId,
      teacherId,
      scheduleWeek: slot.scheduleWeek,
      weekday: slot.weekday,
      recordKey: bookingRecordKey({ roomId, scheduleWeek: slot.scheduleWeek, weekday: slot.weekday, classPeriod: period, teacherId }),
    } satisfies ParsedBookingSnapshotRow;
    if (seen.has(record.recordKey)) throw new RangeError(`CSV row ${index + 1} duplicates a room/week/day/period booking.`);
    seen.add(record.recordKey);
    parsed.push(record);
  }
  return parsed;
}

function bookingCsvCell(value: string): string {
  return `"${value.replace(/"/g, '""').replace(/\r\n?|\n/g, " ")}"`;
}

function bookingCsv(rows: readonly BookingRow[], exportDate: string): string {
  const output = [["Date", "Period", "Room", "Teacher"], ...rows.map(row => [
    nextOccurrenceDate(row.scheduleWeek, row.weekday, exportDate),
    roomSlotPeriodLabel.get(row.classPeriod) ?? row.classPeriod,
    row.roomNumber,
    row.teacherName,
  ])];
  return `\uFEFF${output.map(row => row.map(bookingCsvCell).join(",")).join("\r\n")}\r\n`;
}

async function readBookingRows(db: BookingReader, lockForUpdate = false): Promise<BookingRow[]> {
  const query = db.select({
    id: bookings.id,
    roomId: bookings.roomId,
    roomNumber: classrooms.roomNumber,
    teacherId: bookings.teacherId,
    teacherName: bookings.teacherName,
    scheduleWeek: bookings.scheduleWeek,
    weekday: bookings.weekday,
    classPeriod: bookings.classPeriod,
    createdAt: bookings.createdAt,
  })
    .from(bookings)
    .innerJoin(classrooms, eq(bookings.roomId, classrooms.id))
    .orderBy(asc(bookings.scheduleWeek), asc(bookings.weekday), asc(bookings.classPeriod), asc(classrooms.displayOrder), asc(bookings.id));
  return lockForUpdate ? query.for("update") : query;
}

async function requireBookingsDb(res: express.Response): Promise<BookingDb | null> {
  const db = await getDb();
  if (!db) {
    res.status(503).json({ message: "The room booking database is not configured." });
    return null;
  }
  try {
    await ensureBookingsSchema(db);
    return db;
  } catch {
    res.status(503).json({ message: "Room booking storage is temporarily unavailable." });
    return null;
  }
}

function csvRoomMap(rows: readonly BookingRow[]): Map<string, number> {
  return new Map(rows.map(row => [row.roomNumber.toLocaleUpperCase("en"), row.roomId]));
}

function csvTeacherMap(rows: readonly BookingRow[]): Map<string, string> {
  return new Map(rows.map(row => [normalizedTeacherKey(row.teacherName), row.teacherName]));
}

export function cancellationPlan(
  current: readonly BookingRow[],
  uploaded: readonly ParsedBookingSnapshotRow[],
  exportDate: string,
): SnapshotPlan {
  const currentByKey = new Map(current.map(row => [bookingRecordKey(row), row]));
  const keptKeys = new Set<string>();
  for (const row of uploaded) {
    const existing = currentByKey.get(row.recordKey);
    if (!existing) {
      throw new RangeError("This CSV may only cancel rows from the downloaded snapshot; added or modified bookings are not accepted.");
    }
    const expectedDate = nextOccurrenceDate(existing.scheduleWeek, existing.weekday, exportDate);
    const expectedPeriod = roomSlotPeriodLabel.get(existing.classPeriod) ?? existing.classPeriod;
    if (row.date !== expectedDate
      || row.periodCell !== expectedPeriod
      || row.roomCell !== existing.roomNumber
      || row.teacherCell !== existing.teacherName) {
      throw new RangeError("A retained CSV row was edited. Only remove complete rows from the downloaded snapshot.");
    }
    keptKeys.add(row.recordKey);
  }
  return {
    currentCount: current.length,
    retainedCount: keptKeys.size,
    cancelledIds: current.filter(row => !keptKeys.has(bookingRecordKey(row))).map(row => row.id),
  };
}

function parseUploadedSnapshot(req: express.Request, current: readonly BookingRow[]): ParsedBookingSnapshotRow[] {
  if (!Buffer.isBuffer(req.body)) throw new RangeError("Upload the downloaded Master Schedule CSV as the request body.");
  return parseBookingCsvSnapshot(req.body, csvRoomMap(current), csvTeacherMap(current));
}

function snapshotClaims(req: express.Request, res: express.Response) {
  const claims = verifyAdminBookingSnapshotToken(req.get("x-booking-snapshot-token"));
  if (!claims) {
    res.status(409).json({ message: "Download a fresh Master Schedule CSV in this Admin session before uploading it. The signed snapshot is missing or expired." });
    return null;
  }
  return claims;
}

export function registerAdminBookingRoutes(
  app: express.Express,
  requireAdmin: RequestHandler,
  requireAdminPageRequest: RequestHandler,
): void {
  app.get(ADMIN_PATH, requireAdmin, requireAdminPageRequest, async (_req, res) => {
    try {
      const db = await requireBookingsDb(res);
      if (!db) return;
      const rows = await readBookingRows(db);
      res.set("Cache-Control", "no-store, private").json({ bookings: rows.map(row => ({
        id: row.id,
        date: nextOccurrenceDate(row.scheduleWeek, row.weekday),
        period: roomSlotPeriodLabel.get(row.classPeriod) ?? row.classPeriod,
        week: row.scheduleWeek,
        day: row.weekday,
        room: row.roomNumber,
        teacher: row.teacherName,
        createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
      })) });
    } catch (error) {
      console.error(`[Admin Bookings] Booking list failed${databaseErrorCode(error) ? ` (${databaseErrorCode(error)})` : ""}.`);
      res.status(500).json({ message: "Active bookings could not be loaded." });
    }
  });

  app.get(`${ADMIN_PATH}/export`, requireAdmin, requireAdminPageRequest, async (_req, res) => {
    try {
      const db = await requireBookingsDb(res);
      if (!db) return;
      const rows = await readBookingRows(db);
      const exportedAt = Date.now();
      const exportDate = dateInHongKong(exportedAt);
      const token = createAdminBookingSnapshotToken(bookingSnapshotHash(rows), exportedAt);
      res.set({
        "Cache-Control": "no-store, private",
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="campus-locator-master-schedule.csv"',
        "X-Booking-Snapshot-Token": token,
      }).send(bookingCsv(rows, exportDate));
    } catch (error) {
      console.error(`[Admin Bookings] CSV export failed${databaseErrorCode(error) ? ` (${databaseErrorCode(error)})` : ""}.`);
      res.status(500).json({ message: "The master booking CSV could not be exported." });
    }
  });

  app.delete(`${ADMIN_PATH}/:id`, requireAdmin, requireAdminPageRequest, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) {
      res.status(400).json({ message: "Select a valid booking row to remove." });
      return;
    }
    try {
      const db = await requireBookingsDb(res);
      if (!db) return;
      const removed = await db.transaction(async tx => {
        const [existing] = await tx.select({ id: bookings.id }).from(bookings).where(eq(bookings.id, id)).limit(1).for("update");
        if (!existing) return false;
        await tx.delete(bookings).where(eq(bookings.id, id));
        return true;
      });
      if (!removed) {
        res.status(404).json({ message: "That booking row no longer exists." });
        return;
      }
      res.set("Cache-Control", "no-store").json({ removed: true, id });
    } catch (error) {
      console.error(`[Admin Bookings] Row deletion transaction failed${databaseErrorCode(error) ? ` (${databaseErrorCode(error)})` : ""}; rollback completed.`);
      res.status(500).json({ message: "The booking row could not be removed; no partial update was applied." });
    }
  });

  const csvBody = express.raw({ type: CSV_CONTENT_TYPES, limit: MAX_CSV_FILE_BYTES });
  app.post(`${ADMIN_PATH}/csv/preview`, requireAdmin, requireAdminPageRequest, csvBody, async (req, res) => {
    const claims = snapshotClaims(req, res);
    if (!claims) return;
    try {
      const db = await requireBookingsDb(res);
      if (!db) return;
      const current = await readBookingRows(db);
      if (bookingSnapshotHash(current) !== claims.snapshotHash) throw new StaleBookingSnapshotError();
      const uploaded = parseUploadedSnapshot(req, current);
      const plan = cancellationPlan(current, uploaded, dateInHongKong(claims.issuedAt));
      res.set("Cache-Control", "no-store, private").json({
        currentCount: plan.currentCount,
        retainedCount: plan.retainedCount,
        cancelledCount: plan.cancelledIds.length,
        requiresEmptyConfirmation: plan.currentCount > 0 && plan.retainedCount === 0,
      });
    } catch (error) {
      if (error instanceof StaleBookingSnapshotError) {
        res.status(409).json({ message: error.message });
        return;
      }
      if (error instanceof RangeError) {
        res.status(422).json({ message: error.message });
        return;
      }
      console.error(`[Admin Bookings] CSV preview failed${databaseErrorCode(error) ? ` (${databaseErrorCode(error)})` : ""}.`);
      res.status(500).json({ message: "The CSV snapshot could not be validated." });
    }
  });

  app.post(`${ADMIN_PATH}/csv/sync`, requireAdmin, requireAdminPageRequest, csvBody, async (req, res) => {
    const claims = snapshotClaims(req, res);
    if (!claims) return;
    const confirmEmpty = req.get("x-confirm-empty-snapshot") === "true";
    try {
      const db = await requireBookingsDb(res);
      if (!db) return;
      const result = await db.transaction(async tx => {
        const current = await readBookingRows(tx, true);
        if (bookingSnapshotHash(current) !== claims.snapshotHash) throw new StaleBookingSnapshotError();
        const uploaded = parseUploadedSnapshot(req, current);
        const plan = cancellationPlan(current, uploaded, dateInHongKong(claims.issuedAt));
        if (plan.currentCount > 0 && plan.retainedCount === 0 && !confirmEmpty) {
          throw new RangeError("This CSV would cancel every active booking. Confirm cancel-all in the Admin page and retry.");
        }
        if (plan.cancelledIds.length > 0) {
          await tx.delete(bookings).where(inArray(bookings.id, plan.cancelledIds));
        }
        return plan;
      });
      console.info(`[Admin Bookings] CSV cancellation snapshot committed: cancelled=${result.cancelledIds.length}, retained=${result.retainedCount}.`);
      res.set("Cache-Control", "no-store, private").json({
        cancelledCount: result.cancelledIds.length,
        retainedCount: result.retainedCount,
        message: `${result.cancelledIds.length} booking${result.cancelledIds.length === 1 ? "" : "s"} cancelled; ${result.retainedCount} retained.`,
      });
    } catch (error) {
      if (error instanceof StaleBookingSnapshotError) {
        res.status(409).json({ message: error.message });
        return;
      }
      if (error instanceof RangeError) {
        res.status(422).json({ message: error.message });
        return;
      }
      console.error(`[Admin Bookings] CSV cancellation transaction failed${databaseErrorCode(error) ? ` (${databaseErrorCode(error)})` : ""}; rollback completed.`);
      res.status(500).json({ message: "The booking cancellations could not be saved; no partial update was applied." });
    }
  });
}

export function adminBookingsUploadErrorHandler(): express.ErrorRequestHandler {
  return (error, req, res, next) => {
    if (!req.path.startsWith(`${ADMIN_PATH}/csv/`)) {
      next(error);
      return;
    }
    const status = (error as { status?: number; type?: string }).status;
    if (status === 413 || (error as { type?: string }).type === "entity.too.large") {
      res.status(413).json({ message: "The booking CSV is larger than the 5 MB upload limit; no bookings were changed." });
      return;
    }
    console.error("[Admin Bookings] CSV request parsing failed.");
    res.status(400).json({ message: "The booking CSV could not be read; no bookings were changed." });
  };
}
