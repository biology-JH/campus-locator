import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type RequestHandler } from "express";
import type { Server } from "node:http";

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));
vi.mock("./db.js", () => ({ getDb: getDbMock }));
vi.mock("./bookings-schema.js", () => ({ ensureBookingsSchema: vi.fn(async () => undefined) }));

import {
  ADMIN_BOOKING_SNAPSHOT_LIFETIME_MS,
  createAdminBookingSnapshotToken,
  hasConfiguredAdminPassword,
  isValidAdminPasswordSessionToken,
  verifyAdminBookingSnapshotToken,
  verifyAdminPassword,
} from "./_core/admin-session.js";
import {
  adminBookingsUploadErrorHandler,
  bookingSnapshotHash,
  cancellationPlan,
  nextOccurrenceDate,
  parseBookingCsvSnapshot,
  registerAdminBookingRoutes,
  type BookingRow,
} from "./admin-bookings.js";
import { PERIODS } from "../shared/timetable.js";

const LOCAL_ADMIN_PASSWORD = "local-only-admin-password-for-tests-2026";
const rooms = new Map([["A101", 1]]);
const teachers = new Map([["alice smith", "Alice Smith"]]);

function csv(rows: string[]): Buffer {
  return Buffer.from(["Date,Period,Room,Teacher", ...rows].join("\r\n"), "utf8");
}

function bookingRow(id: number, date: string, period: string): BookingRow {
  const [parsed] = parseBookingCsvSnapshot(csv([`"${date}","${period}","A101","Alice Smith"`]), rooms, teachers);
  if (!parsed) throw new Error("Test booking CSV did not parse.");
  return {
    id,
    roomId: parsed.roomId,
    roomNumber: parsed.roomNumber,
    teacherId: parsed.teacherId,
    teacherName: parsed.teacherName,
    scheduleWeek: parsed.scheduleWeek,
    weekday: parsed.weekday,
    classPeriod: parsed.period,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

function exportDateAt(timestamp: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const part = (type: "year" | "month" | "day") => parts.find(value => value.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function exportCsv(rows: readonly BookingRow[], fromDate: string): Buffer {
  const lines = rows.map(row => {
    const date = nextOccurrenceDate(row.scheduleWeek, row.weekday, fromDate);
    const period = PERIODS.find(item => item.id === row.classPeriod)?.label ?? row.classPeriod;
    return `"${date}","${period}","${row.roomNumber}","${row.teacherName}"`;
  });
  return csv(lines);
}

function makeBookingDbHarness(initialRows: BookingRow[], failOnDelete = false) {
  let rows = [...initialRows];
  const operations = { lockingReads: 0, deleteCount: 0, rolledBack: false };
  const makeSelect = () => {
    const query: any = {};
    query.from = () => query;
    query.innerJoin = () => query;
    query.orderBy = () => query;
    query.where = () => query;
    query.limit = async (count: number) => rows.slice(0, count).map(row => ({ id: row.id }));
    query.for = (lock: string) => {
      if (lock === "update") operations.lockingReads += 1;
      return query;
    };
    query.then = (resolve: (value: BookingRow[]) => unknown, reject: (error: unknown) => unknown) =>
      Promise.resolve([...rows]).then(resolve, reject);
    return query;
  };
  const tx = {
    select: makeSelect,
    delete: () => ({
      where: async () => {
        operations.deleteCount += 1;
        rows = [];
        if (failOnDelete) throw new Error("mock transaction delete failure");
      },
    }),
  };
  const db = {
    select: makeSelect,
    transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => {
      const before = [...rows];
      try {
        return await callback(tx);
      } catch (error) {
        rows = before;
        operations.rolledBack = true;
        throw error;
      }
    },
  };
  return { db, operations, rowCount: () => rows.length };
}

async function startBookingAdminServer() {
  const app = express();
  const allowAdmin: RequestHandler = (_req, _res, next) => next();
  registerAdminBookingRoutes(app, allowAdmin, allowAdmin);
  app.use(adminBookingsUploadErrorHandler());
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not open the local booking-admin test server.");
  return { server, url: `http://127.0.0.1:${address.port}` };
}

describe("Admin booking CSV validation", () => {
  it("derives the recurring slot from a date using the confirmed school cycle", () => {
    const [booking] = parseBookingCsvSnapshot(csv(['"2026-10-26","Lesson 1","A101","Alice Smith"']), rooms, teachers);
    expect(booking).toMatchObject({
      date: "2026-10-26",
      period: "lesson1",
      roomNumber: "A101",
      teacherName: "Alice Smith",
      roomId: 1,
      scheduleWeek: "A",
      weekday: "Monday",
    });
  });

  it("rejects duplicate recurring room slots and dates in the school's skipped week", () => {
    const duplicateRows = csv([
      '"2026-10-26","Lesson 1","A101","Alice Smith"',
      '"2026-10-26","Lesson 1","A101","Alice Smith"',
    ]);
    expect(() => parseBookingCsvSnapshot(duplicateRows, rooms, teachers)).toThrow(/duplicates a room\/week\/day\/period/);
    expect(() => parseBookingCsvSnapshot(csv(['"2027-06-09","Lesson 2","A101","Alice Smith"']), rooms, teachers))
      .toThrow(/school week beginning 2027-06-07 is skipped/);
  });

  it("requires the exact four-column header and a current staff name", () => {
    expect(() => parseBookingCsvSnapshot(Buffer.from("Date,Period,Room,Teacher,Extra\n"), rooms, teachers))
      .toThrow(/exact CSV columns/);
    expect(() => parseBookingCsvSnapshot(csv(['"2026-10-26","Lesson 1","A101","Unknown Person"']), rooms, teachers))
      .toThrow(/not on the current staff list/);
  });

  it("finds the next occurrence across the school skip and matches the June Week B marker", () => {
    expect(nextOccurrenceDate("A", "Monday", "2027-06-07")).toBe("2027-06-14");
    expect(nextOccurrenceDate("B", "Tuesday", "2027-06-01")).toBe("2027-06-01");
  });

  it("cancels only omitted complete rows and rejects edited values even when the date maps to the same cycle slot", () => {
    const original = parseBookingCsvSnapshot(csv(['"2026-10-26","Lesson 1","A101","Alice Smith"']), rooms, teachers);
    const second = bookingRow(8, "2026-10-27", "Lesson 2");
    const current = [bookingRow(7, "2026-10-26", "Lesson 1"), second];
    expect(cancellationPlan(current, original, "2026-10-26")).toMatchObject({
      currentCount: 2,
      retainedCount: 1,
      cancelledIds: [8],
    });

    const laterSameWeek = parseBookingCsvSnapshot(csv(['"2026-11-09","Lesson 1","A101","Alice Smith"']), rooms, teachers);
    expect(laterSameWeek[0]?.recordKey).toBe(original[0]?.recordKey);
    expect(() => cancellationPlan([current[0]!], laterSameWeek, "2026-10-26"))
      .toThrow(/retained CSV row was edited/);
    const alteredTeacherCell = parseBookingCsvSnapshot(csv(['"2026-10-26","Lesson 1","A101","alice smith"']), rooms, teachers);
    expect(() => cancellationPlan([current[0]!], alteredTeacherCell, "2026-10-26"))
      .toThrow(/retained CSV row was edited/);
  });

  it("hashes snapshots deterministically and detects room or teacher changes", () => {
    const first = {
      id: 7,
      roomId: 1,
      roomNumber: "A101",
      teacherName: "Alice Smith",
      scheduleWeek: "A" as const,
      weekday: "Monday" as const,
      classPeriod: "lesson1" as const,
      teacherId: "a".repeat(32),
    };
    const second = { ...first, id: 8, roomId: 2, roomNumber: "A102", scheduleWeek: "B" as const, weekday: "Tuesday" as const };
    expect(bookingSnapshotHash([first, second])).toBe(bookingSnapshotHash([second, first]));
    expect(bookingSnapshotHash([first])).not.toBe(bookingSnapshotHash([{ ...first, teacherName: "Changed Name" }]));
    expect(bookingSnapshotHash([first])).not.toBe(bookingSnapshotHash([{ ...first, roomNumber: "A102" }]));
  });
});

describe("Admin booking snapshot tokens and password fallback", () => {
  beforeEach(() => {
    vi.stubEnv("ADMIN_SECRET_KEY", "");
    vi.stubEnv("ROOMFINDER_ADMIN_PASSWORD", LOCAL_ADMIN_PASSWORD);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses ROOMFINDER_ADMIN_PASSWORD for Admin login sessions and snapshot signing", () => {
    expect(hasConfiguredAdminPassword()).toBe(true);
    expect(verifyAdminPassword(LOCAL_ADMIN_PASSWORD)).toBe(true);
    expect(verifyAdminPassword("not-the-password")).toBe(false);
    const sessionToken = createAdminBookingSnapshotToken("a".repeat(64));
    expect(verifyAdminBookingSnapshotToken(sessionToken)?.snapshotHash).toBe("a".repeat(64));
    expect(isValidAdminPasswordSessionToken(sessionToken)).toBe(false);
  });

  it("rejects tampered and expired snapshot tokens", () => {
    const now = Date.now();
    const token = createAdminBookingSnapshotToken("b".repeat(64), now);
    expect(verifyAdminBookingSnapshotToken(token, now)).toMatchObject({ snapshotHash: "b".repeat(64) });
    const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
    expect(verifyAdminBookingSnapshotToken(tampered, now)).toBeNull();
    expect(verifyAdminBookingSnapshotToken(token, now + ADMIN_BOOKING_SNAPSHOT_LIFETIME_MS + 1)).toBeNull();
  });
});

describe("Admin booking CSV cancellation transactions", () => {
  let server: Server | undefined;
  let baseUrl = "";

  beforeEach(async () => {
    vi.stubEnv("ADMIN_SECRET_KEY", LOCAL_ADMIN_PASSWORD);
    vi.stubEnv("ROOMFINDER_ADMIN_PASSWORD", "");
    getDbMock.mockReset();
    ({ server, url: baseUrl } = await startBookingAdminServer());
  });

  afterEach(async () => {
    if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    server = undefined;
    vi.unstubAllEnvs();
  });

  function snapshotToken(rows: readonly BookingRow[], issuedAt: number): string {
    return createAdminBookingSnapshotToken(bookingSnapshotHash(rows), issuedAt);
  }

  async function postSnapshot(
    rows: readonly BookingRow[],
    uploadedRows: readonly BookingRow[],
    options: { confirmEmpty?: boolean; failOnDelete?: boolean } = {},
  ) {
    const issuedAt = Date.now();
    const harness = makeBookingDbHarness([...rows], options.failOnDelete);
    getDbMock.mockResolvedValue(harness.db);
    const headers: Record<string, string> = {
      "Content-Type": "text/csv",
      "X-Requested-With": "RoomfinderAdmin",
      "X-Booking-Snapshot-Token": snapshotToken(rows, issuedAt),
    };
    if (options.confirmEmpty) headers["X-Confirm-Empty-Snapshot"] = "true";
    const response = await fetch(`${baseUrl}/api/admin/bookings/csv/sync`, {
      method: "POST",
      headers,
      body: new Uint8Array(exportCsv(uploadedRows, exportDateAt(issuedAt))),
    });
    return { response, harness };
  }

  it("locks the snapshot and transactionally cancels only omitted rows", async () => {
    const issuedAt = Date.now();
    const exportDate = exportDateAt(issuedAt);
    const rows = [
      bookingRow(7, nextOccurrenceDate("A", "Monday", exportDate), "Lesson 1"),
      bookingRow(8, nextOccurrenceDate("A", "Tuesday", exportDate), "Lesson 2"),
    ];
    const { response, harness } = await postSnapshot(rows, [rows[0]!]);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ cancelledCount: 1, retainedCount: 1 });
    expect(harness.operations.lockingReads).toBe(1);
    expect(harness.operations.deleteCount).toBe(1);
    expect(harness.operations.rolledBack).toBe(false);
  });

  it("blocks empty snapshots unless the Admin explicitly confirms cancel-all", async () => {
    const issuedAt = Date.now();
    const row = bookingRow(7, nextOccurrenceDate("A", "Monday", exportDateAt(issuedAt)), "Lesson 1");
    const blocked = await postSnapshot([row], []);
    expect(blocked.response.status).toBe(422);
    expect(blocked.harness.operations.deleteCount).toBe(0);
    expect(blocked.harness.operations.rolledBack).toBe(true);

    const confirmed = await postSnapshot([row], [], { confirmEmpty: true });
    expect(confirmed.response.status).toBe(200);
    await expect(confirmed.response.json()).resolves.toMatchObject({ cancelledCount: 1, retainedCount: 0 });
    expect(confirmed.harness.operations.deleteCount).toBe(1);
  });

  it("returns failure and records a rollback when a cancellation write fails", async () => {
    const issuedAt = Date.now();
    const exportDate = exportDateAt(issuedAt);
    const rows = [
      bookingRow(7, nextOccurrenceDate("A", "Monday", exportDate), "Lesson 1"),
      bookingRow(8, nextOccurrenceDate("A", "Tuesday", exportDate), "Lesson 2"),
    ];
    const { response, harness } = await postSnapshot(rows, [rows[0]!], { failOnDelete: true });
    expect(response.status).toBe(500);
    expect(harness.operations.deleteCount).toBe(1);
    expect(harness.operations.rolledBack).toBe(true);
    expect(harness.rowCount()).toBe(rows.length);
  });
});
