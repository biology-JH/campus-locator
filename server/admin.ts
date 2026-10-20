import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import express, { type Request, type RequestHandler, type Response } from "express";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { DAYS, PERIODS, WEEKS, type PeriodId } from "@shared/timetable";
import { getDb } from "./db";
import { classrooms, timetableEntries } from "../drizzle/schema";
import { staffForCodes } from "./staff-resolution";

const ADMIN_PATH = "/api/admin";
const SESSION_COOKIE = "roomfinder_admin_session";
const SESSION_LIFETIME_SECONDS = 12 * 60 * 60;
const SESSION_COOKIE_PATH = ADMIN_PATH;
const MAX_EXCEL_JSON_BYTES = 20 * 1024 * 1024;
const MAX_ROOMS = 500;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;
const PASSWORD_SALT = "roomfinder-admin-password-v1";
const SESSION_SALT = "roomfinder-admin-session-v1";
const ADMIN_PASSWORD = process.env.ROOMFINDER_ADMIN_PASSWORD ?? "Admin9988!";
const passwordDigest = ADMIN_PASSWORD ? scryptSync(ADMIN_PASSWORD, PASSWORD_SALT, 32) : null;
const sessionKey = ADMIN_PASSWORD ? scryptSync(ADMIN_PASSWORD, SESSION_SALT, 32) : null;

const loginAttempts = new Map<string, { count: number; windowStart: number; blockedUntil: number }>();
const periodIds = PERIODS.map(period => period.id) as [PeriodId, ...PeriodId[]];
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
  ).length(80),
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

function getCookie(req: Request, name: string): string | undefined {
  const prefix = `${name}=`;
  const pair = req.headers.cookie?.split(";").map(value => value.trim()).find(value => value.startsWith(prefix));
  return pair ? pair.slice(prefix.length) : undefined;
}

function createSessionToken(): string {
  const payload = Buffer.from(JSON.stringify({
    expiresAt: Math.floor(Date.now() / 1000) + SESSION_LIFETIME_SECONDS,
    nonce: randomBytes(24).toString("base64url"),
  })).toString("base64url");
  const signature = createHmac("sha256", sessionKey!).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function isValidSession(req: Request): boolean {
  if (!sessionKey) return false;
  const token = getCookie(req, SESSION_COOKIE);
  if (!token || token.length > 512) return false;
  const [payload, suppliedSignature, extra] = token.split(".");
  if (!payload || !suppliedSignature || extra !== undefined) return false;

  const expected = createHmac("sha256", sessionKey).update(payload).digest();
  let received: Buffer;
  try {
    received = Buffer.from(suppliedSignature, "base64url");
  } catch {
    return false;
  }
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return false;

  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { expiresAt?: unknown; nonce?: unknown };
    return typeof decoded.expiresAt === "number"
      && decoded.expiresAt > Math.floor(Date.now() / 1000)
      && typeof decoded.nonce === "string"
      && decoded.nonce.length >= 16;
  } catch {
    return false;
  }
}

function setSessionCookie(req: Request, res: Response, token: string) {
  const forwardedProtocol = req.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  const localHost = ["localhost", "127.0.0.1", "::1"].includes(req.hostname);
  const plainHttpLocal = localHost && forwardedProtocol !== "https";
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: !plainHttpLocal,
    sameSite: plainHttpLocal ? "lax" : "none",
    path: SESSION_COOKIE_PATH,
    maxAge: SESSION_LIFETIME_SECONDS * 1000,
  });
}

function clearSessionCookie(req: Request, res: Response) {
  const forwardedProtocol = req.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  const localHost = ["localhost", "127.0.0.1", "::1"].includes(req.hostname);
  const plainHttpLocal = localHost && forwardedProtocol !== "https";
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: !plainHttpLocal,
    sameSite: plainHttpLocal ? "lax" : "none",
    path: SESSION_COOKIE_PATH,
  });
}

const requireAdmin: RequestHandler = (req, res, next) => {
  if (!isValidSession(req)) {
    res.status(401).json({ message: "Admin sign-in required." });
    return;
  }
  next();
};

function requireAdminRequestHeader(req: Request, res: Response): boolean {
  if (req.get("x-requested-with") === "RoomfinderAdmin") return true;
  res.status(403).json({ message: "This admin action must be submitted from the admin page." });
  return false;
}

function loginKey(req: Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

function loginIsBlocked(key: string): boolean {
  const current = loginAttempts.get(key);
  if (!current) return false;
  const now = Date.now();
  if (current.blockedUntil > now) return true;
  if (now - current.windowStart >= LOGIN_WINDOW_MS) {
    loginAttempts.delete(key);
    return false;
  }
  return false;
}

function recordFailedLogin(key: string) {
  const now = Date.now();
  const previous = loginAttempts.get(key);
  const current = previous && now - previous.windowStart < LOGIN_WINDOW_MS
    ? previous
    : { count: 0, windowStart: now, blockedUntil: 0 };
  current.count += 1;
  if (current.count >= MAX_LOGIN_ATTEMPTS) current.blockedUntil = now + LOGIN_WINDOW_MS;
  loginAttempts.set(key, current);
}

function passwordMatches(candidate: unknown): boolean {
  if (!passwordDigest || typeof candidate !== "string" || candidate.length < 1 || candidate.length > 256) return false;
  const candidateDigest = scryptSync(candidate, PASSWORD_SALT, 32);
  return timingSafeEqual(candidateDigest, passwordDigest);
}

function validateTimetable(timetable: ParsedTimetable): ParsedTimetable {
  const seenRooms = new Set<string>();
  const seenSlots = new Set<string>();
  for (const room of timetable.rooms) {
    const normalizedRoom = room.room.toUpperCase();
    if (seenRooms.has(normalizedRoom)) throw new Error("The workbook contains duplicate room labels.");
    seenRooms.add(normalizedRoom);
    for (const slot of room.schedule) {
      const key = `${normalizedRoom}|${slot.week}|${slot.day}|${slot.period}`;
      if (seenSlots.has(key)) throw new Error("The workbook contains duplicate room schedule slots.");
      seenSlots.add(key);
    }
  }
  return timetable;
}

async function replaceTimetable(timetable: ParsedTimetable) {
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

  await db.transaction(async tx => {
    await tx.delete(timetableEntries);
    await tx.delete(classrooms);
    for (let index = 0; index < roomRows.length; index += 200) {
      await tx.insert(classrooms).values(roomRows.slice(index, index + 200));
    }
    for (let index = 0; index < entries.length; index += 200) {
      await tx.insert(timetableEntries).values(entries.slice(index, index + 200));
    }
  });
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
      occupant: entry.occupant,
      occupantDisplay: entry.occupantDisplay,
      staffCodes: entry.staffCodes?.split(",").map(code => code.trim()).filter(Boolean) ?? [],
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

export function registerAdminRoutes(app: express.Express) {
  app.get(`${ADMIN_PATH}/session`, (req, res) => {
    res.set("Cache-Control", "no-store").json({ authenticated: isValidSession(req) });
  });

  app.post(`${ADMIN_PATH}/login`, (req, res) => {
    if (!requireAdminRequestHeader(req, res)) return;
    if (!passwordDigest || !sessionKey) {
      res.status(503).json({ message: "Admin sign-in is not configured on this server." });
      return;
    }
    const key = loginKey(req);
    if (loginIsBlocked(key)) {
      res.status(429).json({ message: "Too many sign-in attempts. Wait 15 minutes and try again." });
      return;
    }
    if (!passwordMatches(req.body?.password)) {
      recordFailedLogin(key);
      res.status(401).json({ message: "Password not recognized." });
      return;
    }
    loginAttempts.delete(key);
    setSessionCookie(req, res, createSessionToken());
    res.set("Cache-Control", "no-store").json({ authenticated: true });
  });

  app.post(`${ADMIN_PATH}/logout`, requireAdmin, (req, res) => {
    if (!requireAdminRequestHeader(req, res)) return;
    clearSessionCookie(req, res);
    res.set("Cache-Control", "no-store").json({ authenticated: false });
  });

  app.get(`${ADMIN_PATH}/timetable/export`, requireAdmin, async (req, res) => {
    if (!requireAdminRequestHeader(req, res)) return;
    try {
      const rooms = await readCurrentTimetable();
      res.set("Cache-Control", "no-store").json({ rooms, exportedAt: new Date().toISOString() });
    } catch {
      res.status(500).json({ message: "The current timetable could not be read from the database." });
    }
  });

  app.post(`${ADMIN_PATH}/timetable/excel`, requireAdmin, express.json({ limit: MAX_EXCEL_JSON_BYTES }), async (req, res) => {
    if (!requireAdminRequestHeader(req, res)) return;
    let timetable: ParsedTimetable;
    try {
      timetable = validateTimetable(timetablePayloadSchema.parse(req.body));
    } catch (error) {
      console.error("[Admin] Excel validation failed", error instanceof Error ? error.message : "unknown error");
      res.status(422).json({ message: "This Excel schedule is incomplete or invalid. The existing timetable was not changed." });
      return;
    }
    try {
      await replaceTimetable(timetable);
    } catch (error) {
      console.error("[Admin] Excel timetable replacement failed; database transaction rolled back.", error instanceof Error ? error.name : "unknown error");
      res.status(500).json({ message: "The new timetable could not be saved. The existing timetable was not changed." });
      return;
    }
    res.set("Cache-Control", "no-store").json({
      roomsProcessed: timetable.rooms.length,
      message: `Database updated successfully! ${timetable.rooms.length} rooms processed.`,
    });
  });
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
    res.status(400).json({ message: "The Excel schedule could not be read. The existing timetable was not changed." });
  };
}
