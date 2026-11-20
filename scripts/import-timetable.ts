import dotenv from "dotenv";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import XLSX from "xlsx";
import { DAYS, isNonRoomLocationLabel, normalizeKnownTimetableText, PERIODS, WEEKS, type Day, type PeriodId, type Week } from "../shared/timetable";
import { capitalizeBracketedNames, isExcludedTeacherCode, isExcludedTeacherName } from "../shared/teacher-names";
import { classrooms, timetableEntries } from "../drizzle/schema";

dotenv.config({ path: [".env.local", ".env"] });

const inputFile = process.argv.slice(2).find(argument => argument !== "--");
if (!inputFile) {
  throw new Error("Usage: pnpm db:import-timetable -- <path-to-xlsx-or-csv>");
}

const connectionString = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL_UNPOOLED or DATABASE_URL is required to import the timetable.");
}

const requiredHeaders = ["Room", "Source Page", "Week", "Day", "Period", "Occupant", "Occupant Display", "Teacher Codes"];
const slotsPerRoom = WEEKS.length * DAYS.length * PERIODS.length;
const chunkSize = 400;

type RawRow = Record<string, unknown>;
type ImportRoom = { roomNumber: string; sourcePage: number; displayOrder: number };
type ImportEntry = {
  roomNumber: string;
  week: Week;
  day: Day;
  period: PeriodId;
  occupant: string | null;
  occupantDisplay: string | null;
  staffCodes: string | null;
  sourcePage: number;
};

function normalizeHeader(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function nullableText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function getValue(row: RawRow, aliases: string[]): unknown {
  const key = Object.keys(row).find(candidate => aliases.includes(normalizeHeader(candidate)));
  return key ? row[key] : undefined;
}

function parseWorkbook(filePath: string): { rooms: ImportRoom[]; entries: ImportEntry[] } {
  const workbook = XLSX.readFile(filePath, { cellDates: false });
  const sheetName = workbook.SheetNames.find(name => normalizeHeader(name) === "schedule") ?? workbook.SheetNames[0];
  if (!sheetName) throw new Error("The input file does not contain a schedule sheet.");
  const sheet = workbook.Sheets[sheetName];
  if (!sheet || !sheet["!ref"]) throw new Error("The schedule sheet is empty.");

  const headerRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, range: 0, blankrows: false });
  const headers = (headerRows[0] ?? []).map(normalizeHeader);
  for (const header of requiredHeaders) {
    if (!headers.includes(normalizeHeader(header))) throw new Error(`The schedule is missing the required column “${header}”.`);
  }

  const rows = XLSX.utils.sheet_to_json<RawRow>(sheet, { defval: null, raw: false, blankrows: false });
  if (!rows.length) throw new Error("The schedule contains no timetable rows.");

  const roomOrder = new Map<string, number>();
  const roomPages = new Map<string, number>();
  const entries: ImportEntry[] = [];
  const seenSlots = new Set<string>();

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    const rowNumber = index + 2;
    const room = nullableText(getValue(row, ["room", "roomnumber"]))?.toUpperCase();
    if (!room) throw new Error(`Row ${rowNumber} must include Room.`);
    if (isNonRoomLocationLabel(room)) continue;

    const weekText = nullableText(getValue(row, ["week"]))?.toUpperCase();
    const dayText = nullableText(getValue(row, ["day"]));
    const periodText = nullableText(getValue(row, ["period", "periodid"]));
    if (!weekText || !dayText || !periodText) {
      throw new Error(`Row ${rowNumber} must include Week, Day, and Period.`);
    }
    if (!WEEKS.includes(weekText as Week)) throw new Error(`Invalid week on row ${rowNumber}: ${weekText}.`);
    const day = DAYS.find(candidate => candidate.toLowerCase() === dayText.toLowerCase());
    if (!day) throw new Error(`Invalid day on row ${rowNumber}: ${dayText}.`);
    const periodNormalized = periodText.toLowerCase().replace(/\s+/g, "");
    const period = PERIODS.find(item => item.id === periodNormalized)?.id;
    if (!period) throw new Error(`Invalid period on row ${rowNumber}: ${periodText}.`);

    const rawPage = getValue(row, ["sourcepage", "page"]);
    const page = rawPage === null || rawPage === undefined || rawPage === "" ? 1 : Number(rawPage);
    if (!Number.isInteger(page) || page < 1 || page > 100000) throw new Error(`Invalid source page on row ${rowNumber}.`);

    if (!roomOrder.has(room)) roomOrder.set(room, roomOrder.size);
    const existingPage = roomPages.get(room);
    if (existingPage !== undefined && existingPage !== page) {
      throw new Error(`Room ${room} has inconsistent source pages (${existingPage} and ${page}).`);
    }
    roomPages.set(room, page);

    const slotKey = `${room}|${weekText}|${day}|${period}`;
    if (seenSlots.has(slotKey)) throw new Error(`Duplicate timetable slot on row ${rowNumber}: ${room} ${weekText} ${day} ${period}.`);
    seenSlots.add(slotKey);

    const occupantText = normalizeKnownTimetableText(nullableText(getValue(row, ["occupant", "rawoccupant", "sourceoccupant"])));
    const occupant = occupantText ? capitalizeBracketedNames(occupantText) ?? null : null;
    const displayText = normalizeKnownTimetableText(nullableText(getValue(row, ["occupantdisplay", "subject", "display"]))) ?? occupant;
    const occupantDisplay = displayText ? capitalizeBracketedNames(displayText) ?? null : null;
    const staffCodes = (nullableText(getValue(row, ["staffcodes", "teachercodes"])) ?? "")
      .split(",")
      .map(code => code.trim())
      .filter(code => Boolean(code) && !isExcludedTeacherCode(code) && !isExcludedTeacherName(code));

    entries.push({
      roomNumber: room,
      week: weekText as Week,
      day: day as Day,
      period: period as PeriodId,
      occupant,
      occupantDisplay,
      staffCodes: staffCodes.join(",") || null,
      sourcePage: page,
    });
  }

  for (const room of roomOrder.keys()) {
    const count = entries.filter(entry => entry.roomNumber === room).length;
    if (count !== slotsPerRoom) {
      throw new Error(`Room ${room} has ${count} timetable cells; expected ${slotsPerRoom}.`);
    }
  }

  const rooms = [...roomOrder.entries()].map(([roomNumber, displayOrder]) => ({
    roomNumber,
    sourcePage: roomPages.get(roomNumber)!,
    displayOrder,
  }));
  return { rooms, entries };
}

async function importTimetable() {
  const { rooms, entries } = parseWorkbook(inputFile);
  const pool = new Pool({ connectionString });
  const db = drizzle(pool);

  try {
    const [existingRooms, existingEntries] = await Promise.all([
      db.select({ id: classrooms.id }).from(classrooms).limit(1),
      db.select({ id: timetableEntries.id }).from(timetableEntries).limit(1),
    ]);
    if (existingRooms.length || existingEntries.length) {
      throw new Error("The target timetable tables are not empty; import stopped without changing existing data.");
    }

    await db.transaction(async tx => {
      for (let index = 0; index < rooms.length; index += chunkSize) {
        await tx.insert(classrooms).values(rooms.slice(index, index + chunkSize));
      }
      for (let index = 0; index < entries.length; index += chunkSize) {
        await tx.insert(timetableEntries).values(entries.slice(index, index + chunkSize));
      }
    });

    const [roomCount] = await db.select({ count: sql<number>`count(*)::int` }).from(classrooms);
    const [entryCount] = await db.select({ count: sql<number>`count(*)::int` }).from(timetableEntries);
    if (roomCount?.count !== rooms.length || entryCount?.count !== entries.length) {
      throw new Error(`Post-import verification failed: ${roomCount?.count ?? 0} rooms and ${entryCount?.count ?? 0} entries are present.`);
    }
    console.log(`Imported and verified ${roomCount.count} classrooms and ${entryCount.count} timetable cells from ${inputFile}.`);
  } finally {
    await pool.end();
  }
}

importTimetable().catch(error => {
  console.error("Timetable import failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
