import express, { type Request, type RequestHandler } from "express";
import { asc, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import * as XLSX from "xlsx";
import { DAYS, PERIODS, WEEKS, type PeriodId } from "../shared/timetable.js";
import { capitalizeBracketedNames, isExcludedTeacherCode, isExcludedTeacherName } from "../shared/teacher-names.js";
import { getDb } from "./db.js";
import { classrooms, timetableEntries } from "../drizzle/schema.js";
import {
  clearAdminPasswordSessionCookie,
  createAdminPasswordSessionToken,
  hasConfiguredAdminPassword,
  hasValidAdminPasswordSession,
  setAdminPasswordSessionCookie,
  verifyAdminPassword,
} from "./_core/admin-session.js";
import { sdk } from "./_core/sdk.js";
import { staffForCodes } from "./staff-resolution.js";

const ADMIN_PATH = "/api/admin";
const MAX_EXCEL_FILE_BYTES = 20 * 1024 * 1024;
const MAX_ROOMS = 500;
const SCHEDULE_ROWS_PER_ROOM = WEEKS.length * DAYS.length * PERIODS.length;
const MAX_WORKSHEET_ROWS = MAX_ROOMS * SCHEDULE_ROWS_PER_ROOM + 1;
const periodIds = PERIODS.map(period => period.id) as [PeriodId, ...PeriodId[]];
const acceptedExcelContentTypes = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/octet-stream",
  "text/csv",
];
const LOGIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS_PER_WINDOW = 8;
const MAX_TRACKED_LOGIN_CLIENTS = 4096;
const loginAttempts = new Map<string, { count: number; windowStartedAt: number }>();

const roomSchema = z.object({
  room: z.string().trim().min(1).max(64),
  page: z.number().int().positive().max(100000),
  schedule: z.array(
    z.object({
      week: z.enum(WEEKS),
      day: z.enum(DAYS),
      period: z.enum(periodIds),
      occupant: z.string().max(2000).nullable(),
      occupantDisplay: z.string().max(2000).nullable(),
      staffCodes: z.array(z.string().trim().min(1).max(32)).max(32),
    }),
  ).length(SCHEDULE_ROWS_PER_ROOM),
});
const timetablePayloadSchema = z.object({
  rooms: z.array(roomSchema).min(1).max(MAX_ROOMS),
});

type ParsedTimetable = z.infer<typeof timetablePayloadSchema>;
type ExportSchedule = {
  week: (typeof WEEKS)[number];
  day: (typeof DAYS)[number];
  period: PeriodId;
  occupant: string | null;
  occupantDisplay: string | null;
  staffCodes: string[];
  teachers: string[];
};
type ExportRoom = { room: string; page: number; schedule: ExportSchedule[] };

function consumeLoginAttempt(clientKey: string, now = Date.now()): boolean {
  for (const [key, attempt] of loginAttempts) {
    if (now - attempt.windowStartedAt >= LOGIN_ATTEMPT_WINDOW_MS) loginAttempts.delete(key);
  }
  const existing = loginAttempts.get(clientKey);
  if (!existing || now - existing.windowStartedAt >= LOGIN_ATTEMPT_WINDOW_MS) {
    loginAttempts.set(clientKey, { count: 1, windowStartedAt: now });
    return true;
  }
  if (existing.count >= MAX_LOGIN_ATTEMPTS_PER_WINDOW) return false;
  existing.count += 1;
  return true;
}

function makeRoomForLoginClient(): void {
  while (loginAttempts.size >= MAX_TRACKED_LOGIN_CLIENTS) {
    const oldestKey = loginAttempts.keys().next().value as string | undefined;
    if (!oldestKey) return;
    loginAttempts.delete(oldestKey);
  }
}

function normalizeHeader(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function textValue(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function valueFrom(row: Record<string, unknown>, aliases: string[]): unknown {
  for (const alias of aliases) {
    const key = Object.keys(row).find(candidate => normalizeHeader(candidate) === alias);
    if (key) return row[key];
  }
  return undefined;
}

function parsePeriod(value: unknown): PeriodId {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/\s+/g, "");
  if (normalized === "mentorgroup" || normalized === "mentor") return "mentor";
  const match = normalized.match(/^(?:lesson|l|p)([1-7])$/);
  if (match) return `lesson${match[1]}` as PeriodId;
  if (periodIds.includes(normalized as PeriodId)) return normalized as PeriodId;
  throw new Error(`Invalid period “${String(value)}”. Use Mentor Group or Lesson 1–7.`);
}

function parseWorkbookBuffer(buffer: Buffer): ParsedTimetable {
  if (!buffer.length) throw new Error("The uploaded workbook is empty.");
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const sheetName = workbook.SheetNames.find(name => normalizeHeader(name) === "schedule") ?? workbook.SheetNames[0];
  if (!sheetName) throw new Error("The workbook does not contain a schedule sheet.");
  const sheet = workbook.Sheets[sheetName];
  if (!sheet || !sheet["!ref"]) throw new Error("The schedule sheet is empty.");

  const range = XLSX.utils.decode_range(sheet["!ref"]);
  if (range.e.r - range.s.r + 1 > MAX_WORKSHEET_ROWS || range.e.c - range.s.c > 99) {
    throw new Error(`The schedule sheet exceeds the supported limit of ${MAX_ROOMS} rooms and ${MAX_WORKSHEET_ROWS - 1} schedule rows.`);
  }
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: false });
  if (!rows.length) throw new Error("The schedule sheet is empty.");

  const roomMap = new Map<string, { room: string; page: number; schedule: ParsedTimetable["rooms"][number]["schedule"] }>();
  for (const row of rows) {
    const room = textValue(valueFrom(row, ["room", "roomnumber"]))?.toUpperCase();
    const week = textValue(valueFrom(row, ["week"]))?.toUpperCase();
    const rawDay = textValue(valueFrom(row, ["day"]));
    const day = DAYS.find(candidate => candidate.toLowerCase() === rawDay?.toLowerCase());
    if (!room || !week || !day) throw new Error("Every schedule row must include a valid Room, Week, and Day.");
    if (!WEEKS.includes(week as (typeof WEEKS)[number])) throw new Error(`Invalid week “${week}”.`);
    const period = parsePeriod(valueFrom(row, ["period", "periodid", "periodlabel"]));
    const occupantValue = textValue(valueFrom(row, ["occupant", "rawoccupant", "sourceoccupant"]));
    const occupant = occupantValue ? capitalizeBracketedNames(occupantValue) : null;
    const displayValue = textValue(valueFrom(row, ["occupantdisplay", "subject", "display"])) ?? occupant;
    const occupantDisplay = displayValue ? capitalizeBracketedNames(displayValue) : null;
    const staffCodes = (textValue(valueFrom(row, ["staffcodes", "teachercodes"])) ?? "")
      .split(",").map(code => code.trim())
      .filter(code => Boolean(code) && !isExcludedTeacherCode(code) && !isExcludedTeacherName(code));
    if (staffCodes.length > 32 || staffCodes.some(code => code.length > 32)) {
      throw new Error(`The teacher codes for ${room} exceed the supported limit.`);
    }
    const rawPage = valueFrom(row, ["sourcepage", "page"]);
    const page = rawPage === null || rawPage === undefined || rawPage === "" ? 1 : Number(rawPage);
    if (!Number.isInteger(page) || page < 1 || page > 100000) throw new Error(`Invalid source page for room ${room}.`);

    const current = roomMap.get(room) ?? { room, page, schedule: [] };
    current.schedule.push({
      week: week as (typeof WEEKS)[number],
      day,
      period,
      occupant,
      occupantDisplay,
      staffCodes,
    });
    roomMap.set(room, current);
  }

  const timetable = timetablePayloadSchema.parse({ rooms: [...roomMap.values()] });
  const seenRooms = new Set<string>();
  for (const room of timetable.rooms) {
    const normalizedRoom = room.room.toUpperCase();
    if (seenRooms.has(normalizedRoom)) throw new Error(`The workbook contains duplicate room “${room.room}”.`);
    seenRooms.add(normalizedRoom);
    const slots = new Set(room.schedule.map(slot => `${slot.week}|${slot.day}|${slot.period}`));
    if (slots.size !== SCHEDULE_ROWS_PER_ROOM) throw new Error(`${room.room} contains duplicate schedule slots.`);
  }
  return timetable;
}

function errorDetails(error: unknown) {
  if (!error || typeof error !== "object") {
    return { message: String(error).slice(0, 1600) };
  }
  const value = error as {
    name?: unknown;
    message?: unknown;
    code?: unknown;
    errno?: unknown;
    sqlState?: unknown;
    stack?: unknown;
  };
  return {
    name: typeof value.name === "string" ? value.name : "Error",
    code: typeof value.code === "string" || typeof value.code === "number" ? value.code : undefined,
    errno: typeof value.errno === "number" ? value.errno : undefined,
    sqlState: typeof value.sqlState === "string" ? value.sqlState : undefined,
    message: typeof value.message === "string" ? value.message.slice(0, 1600) : "Unknown error",
    stack: typeof value.stack === "string" ? value.stack.split("\n").slice(0, 7).join("\n") : undefined,
  };
}

async function upsertTimetable(timetable: ParsedTimetable) {
  const db = await getDb();
  if (!db) throw new Error("The timetable database is not available.");

  const roomRows = timetable.rooms.map((room, displayOrder) => ({
    roomNumber: room.room,
    sourcePage: room.page,
    displayOrder,
  }));
  const entries = timetable.rooms.flatMap(room => room.schedule.map(slot => ({
    roomNumber: room.room,
    week: slot.week,
    day: slot.day,
    period: slot.period,
    occupant: slot.occupant,
    occupantDisplay: slot.occupantDisplay,
    staffCodes: slot.staffCodes.join(",") || null,
    sourcePage: room.page,
  })));
  const roomNumbers = roomRows.map(room => room.roomNumber);

  await db.transaction(async tx => {
    for (let index = 0; index < roomRows.length; index += 200) {
      await tx.insert(classrooms).values(roomRows.slice(index, index + 200)).onDuplicateKeyUpdate({
        set: {
          sourcePage: sql`VALUES(${classrooms.sourcePage})`,
          displayOrder: sql`VALUES(${classrooms.displayOrder})`,
        },
      });
    }
    for (let index = 0; index < entries.length; index += 200) {
      await tx.insert(timetableEntries).values(entries.slice(index, index + 200)).onDuplicateKeyUpdate({
        set: {
          occupant: sql`VALUES(${timetableEntries.occupant})`,
          occupantDisplay: sql`VALUES(${timetableEntries.occupantDisplay})`,
          staffCodes: sql`VALUES(${timetableEntries.staffCodes})`,
          sourcePage: sql`VALUES(${timetableEntries.sourcePage})`,
        },
      });
    }

    // An upload represents the complete schedule: upsert current records first, then remove rows
    // for rooms no longer present so foreign-key cascade and the transaction remain consistent.
    await tx.delete(timetableEntries).where(notInArray(timetableEntries.roomNumber, roomNumbers));
    await tx.delete(classrooms).where(notInArray(classrooms.roomNumber, roomNumbers));
  });

  return { roomsProcessed: roomRows.length, entriesProcessed: entries.length };
}

async function readCurrentTimetable(): Promise<ExportRoom[]> {
  const db = await getDb();
  if (!db) throw new Error("The timetable database is not available.");
  const [roomRows, entryRows] = await Promise.all([
    db.select({ room: classrooms.roomNumber, page: classrooms.sourcePage })
      .from(classrooms)
      .orderBy(asc(classrooms.displayOrder)),
    db.select({
      room: timetableEntries.roomNumber,
      week: timetableEntries.week,
      day: timetableEntries.day,
      period: timetableEntries.period,
      occupant: timetableEntries.occupant,
      occupantDisplay: timetableEntries.occupantDisplay,
      staffCodes: timetableEntries.staffCodes,
    }).from(timetableEntries),
  ]);
  const entriesByRoom = new Map<string, ExportSchedule[]>();
  for (const entry of entryRows) {
    const schedule = entriesByRoom.get(entry.room) ?? [];
    schedule.push({
      week: entry.week,
      day: entry.day,
      period: entry.period,
      occupant: entry.occupant ? capitalizeBracketedNames(entry.occupant) : null,
      occupantDisplay: entry.occupantDisplay ? capitalizeBracketedNames(entry.occupantDisplay) : null,
      staffCodes: entry.staffCodes?.split(",").map(code => code.trim())
        .filter(code => Boolean(code) && !isExcludedTeacherCode(code) && !isExcludedTeacherName(code)) ?? [],
      teachers: staffForCodes(
        entry.staffCodes,
        entry.occupant,
        entry.period,
        { roomNumber: entry.room, week: entry.week, day: entry.day },
      ).flatMap(attribution => attribution.names),
    });
    entriesByRoom.set(entry.room, schedule);
  }
  return roomRows.map(room => ({ room: room.room, page: room.page, schedule: entriesByRoom.get(room.room) ?? [] }));
}

const requireAdmin: RequestHandler = (req, res, next) => {
  if (hasValidAdminPasswordSession(req)) {
    next();
    return;
  }
  void sdk.authenticateRequest(req).then(user => {
    if (user?.role !== "admin") {
      res.status(403).json({ message: "A verified Admin account is required for this action." });
      return;
    }
    next();
  }).catch(() => {
    res.status(403).json({ message: "A verified Admin account is required for this action." });
  });
};

const requireAdminPageRequest: RequestHandler = (req, res, next) => {
  if (req.get("x-requested-with") !== "RoomfinderAdmin") {
    res.status(403).json({ message: "This admin action must be submitted from the admin page." });
    return;
  }
  next();
};

export function registerAdminRoutes(app: express.Express) {
  app.post(`${ADMIN_PATH}/login`, express.json({ limit: "2kb" }), (req, res) => {
    res.set("Cache-Control", "no-store, private");
    if (!hasConfiguredAdminPassword()) {
      console.error("[Admin Auth] Password login is unavailable; configure ADMIN_SECRET_KEY with at least 20 characters.");
      res.status(503).json({ message: "Admin password login is not configured for this deployment." });
      return;
    }

    const clientKey = req.ip || "unknown";
    if (!loginAttempts.has(clientKey)) makeRoomForLoginClient();
    if (!consumeLoginAttempt(clientKey)) {
      res.set("Retry-After", String(Math.ceil(LOGIN_ATTEMPT_WINDOW_MS / 1000)));
      res.status(429).json({ message: "Too many Admin login attempts. Please wait and try again." });
      return;
    }

    if (!verifyAdminPassword(req.body?.password)) {
      res.status(401).json({ message: "The Admin password was not accepted." });
      return;
    }

    loginAttempts.delete(clientKey);
    setAdminPasswordSessionCookie(res, createAdminPasswordSessionToken());
    res.status(200).json({ authenticated: true });
  });

  app.post(`${ADMIN_PATH}/logout`, (_req, res) => {
    clearAdminPasswordSessionCookie(res);
    res.set("Cache-Control", "no-store, private").json({ authenticated: false });
  });

  app.get(`${ADMIN_PATH}/session`, requireAdmin, (_req, res) => {
    res.set("Cache-Control", "no-store").json({ authenticated: true });
  });

  app.get(`${ADMIN_PATH}/timetable/export`, requireAdmin, requireAdminPageRequest, async (_req, res) => {
    try {
      const rooms = await readCurrentTimetable();
      res.set("Cache-Control", "no-store").json({ rooms, exportedAt: new Date().toISOString() });
    } catch (error) {
      console.error("[Admin] Timetable export failed.", errorDetails(error));
      res.status(500).json({ message: "The current timetable could not be read from the database." });
    }
  });

  app.post(
    `${ADMIN_PATH}/timetable/excel`,
    requireAdmin,
    requireAdminPageRequest,
    express.raw({ type: acceptedExcelContentTypes, limit: MAX_EXCEL_FILE_BYTES }),
    async (req, res) => {
      let timetable: ParsedTimetable;
      try {
        if (!Buffer.isBuffer(req.body)) throw new Error("Upload the original Excel or CSV file as the request body.");
        timetable = parseWorkbookBuffer(req.body);
      } catch (error) {
        console.error("[Admin] Excel workbook parsing/validation failed.", errorDetails(error));
        res.status(422).json({ message: "This Excel schedule is incomplete or invalid. The existing timetable was not changed." });
        return;
      }

      try {
        const result = await upsertTimetable(timetable);
        console.info(`[Admin] Excel schedule UPSERT committed: rooms=${result.roomsProcessed}, entries=${result.entriesProcessed}.`);
        res.set("Cache-Control", "no-store").json({
          ...result,
          message: `Database updated successfully! ${result.roomsProcessed} rooms processed.`,
        });
      } catch (error) {
        console.error("[Admin] Excel timetable transaction failed; the database transaction was rolled back.", errorDetails(error));
        res.status(500).json({ message: "The new timetable could not be saved. The existing timetable was not changed." });
      }
    },
  );
}

export function adminUploadErrorHandler(): express.ErrorRequestHandler {
  return (error, req, res, next) => {
    if (!req.path.startsWith(ADMIN_PATH)) {
      next(error);
      return;
    }
    const status = (error as { status?: number; type?: string }).status;
    if (status === 413 || (error as { type?: string }).type === "entity.too.large") {
      res.status(413).json({ message: "The Excel schedule is larger than the 20 MB upload limit. The existing timetable was not changed." });
      return;
    }
    console.error("[Admin] Excel upload request parsing failed.", errorDetails(error));
    res.status(400).json({ message: "The Excel schedule could not be read. The existing timetable was not changed." });
  };
}
