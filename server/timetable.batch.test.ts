import { beforeEach, describe, expect, it, vi } from "vitest";
import { classrooms, timetableEntries } from "../drizzle/schema.js";
import type { TrpcContext } from "./_core/context.js";

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));
vi.mock("./db.js", () => ({ getDb: getDbMock }));

import { appRouter } from "./routers.js";

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

function makeMemoryDatabase(roomCount: 3 | 4) {
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
      for: (...args: unknown[]) => Promise<unknown[]>;
      then: (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) => Promise<unknown>;
    } = {
      where: () => query,
      orderBy: () => query,
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

const selection = { week: "A" as const, day: "Monday" as const, period: "lesson1" as const };

beforeEach(() => {
  getDbMock.mockReset();
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
    console.info(`[Local simulation] Batch schedule save success: ${label} swap committed to in-memory mock DB (${count} rooms); shared Aiven was not modified.`);
  });

  it("rejects a non-Admin before it accesses the database", async () => {
    const caller = appRouter.createCaller(makeContext("user"));
    await expect(caller.timetable.saveBatchScheduleChanges({
      ...selection,
      expectedVersion: "0".repeat(64),
      assignments: [{ roomNumber: "A", sourceRoomNumber: "A" }],
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(getDbMock).not.toHaveBeenCalled();
  });
});
