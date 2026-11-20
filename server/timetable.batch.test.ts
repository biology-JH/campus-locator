import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classrooms, timetableEntries } from "../drizzle/schema.js";
import type { TrpcContext } from "./_core/context.js";
import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";

const { getDbMock, authenticateRequestMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  authenticateRequestMock: vi.fn(),
}));
vi.mock("./db.js", () => ({ getDb: getDbMock }));
vi.mock("./_core/sdk.js", () => ({ sdk: { authenticateRequest: authenticateRequestMock } }));

import { ADMIN_PASSWORD_SESSION_COOKIE, createAdminPasswordSessionToken } from "./_core/admin-session.js";
import { createContext } from "./_core/context.js";
import { appRouter } from "./routers.js";
import { isExcludedTeacherName } from "../shared/teacher-names.js";

const LOCAL_TEST_ADMIN_SECRET = "local-only-admin-secret-for-tests-2026";

type EntryRow = {
  roomNumber: string;
  week: "A";
  day: "Monday";
  period: "lesson1";
  occupant: string;
  occupantDisplay: string;
  staffCodes: string;
  sourcePage: number;
};

type RoomRow = { roomNumber: string; displayOrder: number };

function makeContext(role: "admin" | "user"): TrpcContext {
  const now = new Date();
  return {
    user: {
      id: 1,
      openId: "local-batch-test",
      email: "batch-test@example.invalid",
      name: "Local Batch Test",
      loginMethod: "test",
      role,
      createdAt: now,
      updatedAt: now,
      lastSignedIn: now,
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

function makeMemoryDatabase(roomCount: number) {
  const roomRows: RoomRow[] = Array.from({ length: roomCount }, (_, index) => ({
    roomNumber: String.fromCharCode(65 + index),
    displayOrder: index + 1,
  }));
  const entryRows: EntryRow[] = roomRows.map(room => ({
    roomNumber: room.roomNumber,
    week: "A",
    day: "Monday",
    period: "lesson1",
    occupant: `Class ${room.roomNumber}`,
    occupantDisplay: `Class ${room.roomNumber}`,
    staffCodes: `T${room.roomNumber}`,
    sourcePage: 1,
  }));
  const updatedRooms: string[] = [];

  const rowsForTable = (table: unknown) => table === classrooms ? roomRows : entryRows;
  const queryForTable = (table: unknown) => {
    const rows = rowsForTable(table);
    const query: {
      where: (...args: unknown[]) => typeof query;
      orderBy: (...args: unknown[]) => typeof query;
      limit: (...args: unknown[]) => typeof query;
      for: (...args: unknown[]) => Promise<unknown[]>;
      then: (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) => Promise<unknown>;
    } = {
      where: () => query,
      orderBy: () => query,
      limit: () => query,
      for: () => Promise.resolve(rows),
      then: (resolve, reject) => Promise.resolve(rows).then(resolve, reject),
    };
    return query;
  };

  const tx = {
    select: () => ({ from: queryForTable }),
    update: (_table: unknown) => ({
      set: (values: Partial<EntryRow>) => ({
        where: async () => {
          const roomNumber = roomRows[updatedRooms.length]?.roomNumber;
          const target = entryRows.find(entry => entry.roomNumber === roomNumber);
          if (!target || !roomNumber) throw new Error("Mock update target was not found.");
          Object.assign(target, values);
          updatedRooms.push(roomNumber);
        },
      }),
    }),
  };
  const db = {
    select: () => ({ from: queryForTable }),
    transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)),
  };

  return { db, entryRows, updatedRooms };
}

function makeWebsiteOverlayDatabase(roomRows: unknown[], entryRows: unknown[]) {
  const queryForTable = (table: unknown) => {
    const rows = table === classrooms ? roomRows : entryRows;
    const query: {
      where: (...args: unknown[]) => typeof query;
      orderBy: (...args: unknown[]) => typeof query;
      limit: (...args: unknown[]) => typeof query;
      then: (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) => Promise<unknown>;
    } = {
      where: () => query,
      orderBy: () => query,
      limit: () => query,
      then: (resolve, reject) => Promise.resolve(rows).then(resolve, reject),
    };
    return query;
  };
  return { select: () => ({ from: queryForTable }) };
}

const selection = { week: "A" as const, day: "Monday" as const, period: "lesson1" as const };

beforeEach(() => {
  vi.stubEnv("ADMIN_SECRET_KEY", LOCAL_TEST_ADMIN_SECRET);
  getDbMock.mockReset();
  authenticateRequestMock.mockReset().mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Admin batch schedule save", () => {
  it.each([
    {
      label: "3-way",
      count: 3 as const,
      assignments: [
        { roomNumber: "A", sourceRoomNumber: "B" },
        { roomNumber: "B", sourceRoomNumber: "C" },
        { roomNumber: "C", sourceRoomNumber: "A" },
      ],
      expectedOccupants: ["Class B", "Class C", "Class A"],
    },
    {
      label: "4-way",
      count: 4 as const,
      assignments: [
        { roomNumber: "A", sourceRoomNumber: "B" },
        { roomNumber: "B", sourceRoomNumber: "C" },
        { roomNumber: "C", sourceRoomNumber: "D" },
        { roomNumber: "D", sourceRoomNumber: "A" },
      ],
      expectedOccupants: ["Class B", "Class C", "Class D", "Class A"],
    },
  ])("commits a $label room rotation to the isolated mock transaction", async ({ count, assignments, expectedOccupants, label }) => {
    const memory = makeMemoryDatabase(count);
    getDbMock.mockResolvedValue(memory.db);
    const caller = appRouter.createCaller(makeContext("admin"));
    const snapshot = await caller.timetable.batchEditSnapshot(selection);

    const result = await caller.timetable.saveBatchScheduleChanges({
      ...selection,
      expectedVersion: snapshot.version,
      assignments,
    });

    expect(result.updatedRooms).toBe(count);
    expect(memory.db.transaction).toHaveBeenCalledOnce();
    expect(memory.updatedRooms).toHaveLength(count);
    expect(memory.entryRows.map(entry => entry.occupant)).toEqual(expectedOccupants);
    console.info(`[Local simulation] Batch schedule save success: ${label} swap committed to the in-memory mock DB (${count} rooms).`);
  });

  it("rejects a non-Admin before it accesses the database", async () => {
    const caller = appRouter.createCaller(makeContext("user"));
    await expect(caller.auth.adminSessionStatus()).resolves.toEqual({ isAdmin: false, passwordSession: false, verifiedRole: false });
    await expect(caller.timetable.saveBatchScheduleChanges({
      ...selection,
      expectedVersion: "0".repeat(64),
      assignments: [{ roomNumber: "A", sourceRoomNumber: "A" }],
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(getDbMock).not.toHaveBeenCalled();
  });

  it("unlocks Admin status and batch saving for a verified password session without a database user", async () => {
    const memory = makeMemoryDatabase(3);
    getDbMock.mockResolvedValue(memory.db);
    const token = createAdminPasswordSessionToken();
    const req = {
      protocol: "https",
      headers: { cookie: `${ADMIN_PASSWORD_SESSION_COOKIE}=${token}` },
    } as unknown as TrpcContext["req"];
    const context = await createContext({
      req,
      res: {} as TrpcContext["res"],
      info: {} as CreateExpressContextOptions["info"],
    });
    expect(context.user).toBeNull();
    expect(context.adminPasswordSession).toBe(true);
    expect(authenticateRequestMock).toHaveBeenCalledOnce();
    const caller = appRouter.createCaller(context);
    await expect(caller.auth.adminSessionStatus()).resolves.toEqual({ isAdmin: true, passwordSession: true, verifiedRole: false });
    const snapshot = await caller.timetable.batchEditSnapshot(selection);
    const result = await caller.timetable.saveBatchScheduleChanges({
      ...selection,
      expectedVersion: snapshot.version,
      assignments: [
        { roomNumber: "A", sourceRoomNumber: "B" },
        { roomNumber: "B", sourceRoomNumber: "C" },
        { roomNumber: "C", sourceRoomNumber: "A" },
      ],
    });

    expect(result.updatedRooms).toBe(3);
    expect(memory.db.transaction).toHaveBeenCalledOnce();
    expect(memory.entryRows.map(entry => entry.occupant)).toEqual(["Class B", "Class C", "Class A"]);
    console.info("[Local simulation] Password session batch-save success: 3-way swap committed to the in-memory mock DB.");
  });
});

describe("Room master schedule query", () => {
  it("returns both weeks and free slots when a slot has no subject display text", async () => {
    const memory = makeMemoryDatabase(1);
    getDbMock.mockResolvedValue(memory.db);
    const caller = appRouter.createCaller(makeContext("user"));

    const result = await caller.timetable.masterSchedule({ roomNumber: "A" });
    const weekA = result.weeks.find(week => week.week === "A");
    const monday = weekA?.days.find(day => day.day === "Monday");
    const freeSlot = monday?.slots.find(slot => slot.period === "lesson2");

    expect(result.weeks.map(week => week.week)).toEqual(["A", "B"]);
    expect(result.weeks.every(week => week.days.length === 5 && week.days.every(day => day.slots.length === 8))).toBe(true);
    expect(freeSlot).toMatchObject({ occupant: null, occupantDisplay: null, hasRecord: false, isOccupied: false });
    console.info("[Local simulation] Room Schedule query success: both weeks and all 80 room slots rendered with free slots; mock DB only.");
  });
});

describe("Teacher Finder directory exclusions and name formatting", () => {
  it("returns canonical bracket capitalization and excludes removed identities from autocomplete", async () => {
    const caller = appRouter.createCaller(makeContext("user"));
    const names = await caller.timetable.teacherList();

    expect(names).toContain("Kouaho (Guy) Gueye");
    expect(names).toContain("Xinyao (Yoyo) Feng");
    expect(names).toContain("Gia Baker");
    expect(names).toEqual([...names].sort((left, right) => left.localeCompare(right)));
    expect(names.some(isExcludedTeacherName)).toBe(false);
    expect(names).not.toEqual(expect.arrayContaining(["Gregg Morrison", "Yin Hung Sze", "Robert Kitley"]));
  });

  it("omits removed staff from active and free lists using only the in-memory database mock", async () => {
    const memory = makeMemoryDatabase(3);
    memory.entryRows.forEach(entry => { entry.staffCodes = "GM,YS,RK,KG"; });
    getDbMock.mockResolvedValue(memory.db);
    const caller = appRouter.createCaller(makeContext("user"));
    const result = await caller.timetable.teachersForSlot(selection);
    const names = [
      ...result.activeTeachers.flatMap(assignment => assignment.teacher.split(" / ")),
      ...result.freeTeachers,
    ];

    expect(result.activeTeachers.some(assignment => assignment.teacher.includes("Kouaho (Guy) Gueye"))).toBe(true);
    expect(result.activeTeachers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        teacher: expect.stringContaining("Kouaho (Guy) Gueye"),
        roomNumber: "A",
        subject: "Class A",
      }),
    ]));
    expect(names.some(isExcludedTeacherName)).toBe(false);
    console.info("[Local simulation] Teacher Finder list success: active/free API results omit all excluded names; database access used an in-memory mock only.");
  });
});

describe("website-only vacancy overlay", () => {
  it("shows A802 Tuesday Week B Period 4 vacant across schedule and availability without modifying its mock row", async () => {
    const roomRows = [{ roomNumber: "A802", sourcePage: 1, displayOrder: 1 }];
    const entryRows = [{
      roomNumber: "A802",
      week: "B",
      day: "Tuesday",
      period: "lesson4",
      occupant: "12 Economics IB HL 3",
      occupantDisplay: "12 Economics IB HL 3",
      staffCodes: "BW",
    }];
    getDbMock.mockResolvedValue(makeWebsiteOverlayDatabase(roomRows, entryRows) as never);
    const caller = appRouter.createCaller(makeContext("user"));

    const [schedule, availability] = await Promise.all([
      caller.timetable.masterSchedule({ roomNumber: "A802" }),
      caller.timetable.availability({ week: "B", day: "Tuesday", period: "lesson4" }),
    ]);
    const weekB = schedule.weeks.find(week => week.week === "B");
    const tuesday = weekB?.days.find(day => day.day === "Tuesday");
    const slot = tuesday?.slots.find(item => item.period === "lesson4");

    expect(slot).toMatchObject({
      occupant: null,
      occupantDisplay: null,
      staff: [],
      hasRecord: true,
      isOccupied: false,
    });
    expect(availability.freeRooms).toEqual([
      expect.objectContaining({ roomNumber: "A802", occupant: null, isFree: true }),
    ]);
    expect(availability.occupiedCount).toBe(0);
    expect(entryRows[0]?.occupant).toBe("12 Economics IB HL 3");
    expect(entryRows[0]?.staffCodes).toBe("BW");
  });

  it.each([
    { day: "Wednesday" as const, period: "lesson6" as const },
    { day: "Thursday" as const, period: "lesson3" as const },
  ])("hides Woo Sik Byun and marks his room free on Week B $day $period", async ({ day, period }) => {
    const roomRows = [{ roomNumber: "A804", sourcePage: 1, displayOrder: 1 }];
    const entryRows = [{
      roomNumber: "A804",
      week: "B",
      day,
      period,
      occupant: "12 Economics IB HL 3",
      occupantDisplay: "12 Economics IB HL 3",
      staffCodes: "BW",
    }];
    getDbMock.mockResolvedValue(makeWebsiteOverlayDatabase(roomRows, entryRows) as never);
    const caller = appRouter.createCaller(makeContext("user"));

    const [availability, teachers, teacherLocation] = await Promise.all([
      caller.timetable.availability({ week: "B", day, period }),
      caller.timetable.teachersForSlot({ week: "B", day, period }),
      caller.timetable.teacherLocations({ teacher: "Woo Sik Byun", week: "B", day, period }),
    ]);

    expect(availability.freeRooms).toEqual([
      expect.objectContaining({ roomNumber: "A804", occupant: null, isFree: true }),
    ]);
    expect(teachers.activeTeachers).toEqual([]);
    expect(teachers.freeTeachers).toContain("Woo Sik Byun");
    expect(teacherLocation.matches).toEqual([]);
    expect(entryRows[0]?.staffCodes).toBe("BW");
  });
});
