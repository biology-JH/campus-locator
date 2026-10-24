import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import * as XLSX from "xlsx";
import { DAYS, PERIODS, WEEKS } from "../shared/timetable.js";
import { classrooms, timetableEntries } from "../drizzle/schema.js";

const { getDbMock, authenticateRequestMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  authenticateRequestMock: vi.fn(),
}));
const LOCAL_TEST_ADMIN_SECRET = "local-only-admin-secret-for-tests-2026";

vi.mock("./db.js", () => ({ getDb: getDbMock }));
vi.mock("./_core/sdk.js", () => ({ sdk: { authenticateRequest: authenticateRequestMock } }));

import { ADMIN_PASSWORD_SESSION_COOKIE, ADMIN_PASSWORD_SESSION_LIFETIME_MS, createAdminPasswordSessionToken } from "./_core/admin-session.js";
import { createContext } from "./_core/context.js";
import { adminUploadErrorHandler, registerAdminRoutes } from "./admin.js";
import { appRouter } from "./routers.js";

type DbHarness = {
  db: { transaction: ReturnType<typeof vi.fn> };
  operations: Array<{ kind: string; table: string; rows?: unknown[] }>;
  wasRolledBack: () => boolean;
};

function makeDbHarness(failOnTimetableUpsert = false): DbHarness {
  const operations: DbHarness["operations"] = [];
  let rolledBack = false;
  const tx = {
    insert: (table: unknown) => ({
      values: (rows: unknown[]) => ({
        onDuplicateKeyUpdate: async () => {
          const tableName = table === classrooms ? "classrooms" : "timetable_entries";
          operations.push({ kind: "upsert", table: tableName, rows });
          if (failOnTimetableUpsert && table === timetableEntries) {
            throw Object.assign(new Error("mocked timetable upsert failure"), {
              code: "ER_TEST_WRITE",
              errno: 1234,
              sqlState: "HY000",
            });
          }
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: async () => {
        operations.push({ kind: "delete", table: table === classrooms ? "classrooms" : "timetable_entries" });
      },
    }),
  };
  const db = {
    transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) => {
      try {
        return await callback(tx);
      } catch (error) {
        rolledBack = true;
        throw error;
      }
    }),
  };
  return { db, operations, wasRolledBack: () => rolledBack };
}

function createWorkbook(overrides: Partial<{ occupant: string; occupantDisplay: string; staffCodes: string }> = {}): Buffer {
  const rows = WEEKS.flatMap(week => DAYS.flatMap(day => PERIODS.map(period => ({
    Room: "A101",
    "Source Page": 1,
    Week: week,
    Day: day,
    Period: period.id,
    "Period Label": period.label,
    Occupant: week === "A" && day === "Monday" && period.id === "lesson1" ? overrides.occupant ?? "12 BIO" : "",
    "Occupant Display": week === "A" && day === "Monday" && period.id === "lesson1" ? overrides.occupantDisplay ?? "12 BIO" : "",
    "Teacher Codes": week === "A" && day === "Monday" && period.id === "lesson1" ? overrides.staffCodes ?? "" : "",
  }))));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "Schedule");
  return XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }) as Buffer;
}

async function startServer() {
  const app = express();
  registerAdminRoutes(app);
  app.use(express.json({ limit: "50mb" }));
  app.use("/api/trpc", createExpressMiddleware({ router: appRouter, createContext }));
  app.use(adminUploadErrorHandler());
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not open the local admin test server.");
  return { server, url: `http://127.0.0.1:${address.port}` };
}

let server: Server | undefined;
let baseUrl = "";

beforeEach(async () => {
  vi.stubEnv("ADMIN_SECRET_KEY", LOCAL_TEST_ADMIN_SECRET);
  getDbMock.mockReset();
  authenticateRequestMock.mockReset().mockResolvedValue(null);
  ({ server, url: baseUrl } = await startServer());
});

afterEach(async () => {
  if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
  server = undefined;
  vi.unstubAllEnvs();
});

describe("Admin password session", () => {
  it("checks the password server-side and ignores a spoofed forwarded localhost host", async () => {
    const response = await fetch(`${baseUrl}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-Host": "localhost" },
      body: JSON.stringify({ password: LOCAL_TEST_ADMIN_SECRET }),
    });
    const cookie = response.headers.get("set-cookie");

    expect(response.status).toBe(200);
    expect(cookie).toContain("roomfinder_admin_password_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=None");

    const sessionResponse = await fetch(`${baseUrl}/api/admin/session`, {
      headers: { Cookie: cookie!.split(";")[0] },
    });
    expect(sessionResponse.status).toBe(200);
    expect(await sessionResponse.json()).toMatchObject({ authenticated: true });
    expect(authenticateRequestMock).not.toHaveBeenCalled();
  });

  it("rejects an incorrect password without issuing a session cookie", async () => {
    const response = await fetch(`${baseUrl}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "incorrect-test-password" }),
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("fails closed when ADMIN_SECRET_KEY is not configured", async () => {
    vi.stubEnv("ADMIN_SECRET_KEY", "");
    const response = await fetch(`${baseUrl}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: LOCAL_TEST_ADMIN_SECRET }),
    });
    expect(response.status).toBe(503);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("rejects tampered and expired sessions with HTTP 403 on admin and batch-save APIs", async () => {
    vi.stubEnv("ADMIN_SECRET_KEY", LOCAL_TEST_ADMIN_SECRET);
    const validToken = createAdminPasswordSessionToken();
    const tamperedToken = `${validToken.slice(0, -1)}${validToken.endsWith("A") ? "B" : "A"}`;
    const expiredToken = createAdminPasswordSessionToken(Date.now() - ADMIN_PASSWORD_SESSION_LIFETIME_MS - 1);
    const batchBody = JSON.stringify({
      "0": {
        json: {
          week: "A",
          day: "Monday",
          period: "lesson1",
          expectedVersion: "0".repeat(64),
          assignments: [{ roomNumber: "A", sourceRoomNumber: "A" }],
        },
      },
    });

    for (const token of [tamperedToken, expiredToken]) {
      const cookie = `${ADMIN_PASSWORD_SESSION_COOKIE}=${token}`;
      const session = await fetch(`${baseUrl}/api/admin/session`, { headers: { Cookie: cookie } });
      const exportResponse = await fetch(`${baseUrl}/api/admin/timetable/export`, {
        headers: { Cookie: cookie, "X-Requested-With": "RoomfinderAdmin" },
      });
      const upload = await fetch(`${baseUrl}/api/admin/timetable/excel`, {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "X-Requested-With": "RoomfinderAdmin",
        },
        body: new Uint8Array(createWorkbook()),
      });
      const batchSave = await fetch(`${baseUrl}/api/trpc/timetable.saveBatchScheduleChanges?batch=1`, {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: batchBody,
      });

      expect([session.status, exportResponse.status, upload.status, batchSave.status]).toEqual([403, 403, 403, 403]);
    }

    expect(getDbMock).not.toHaveBeenCalled();
    console.info("[Local simulation] Invalid and expired Admin sessions returned HTTP 403 across all protected endpoints; no database writes occurred.");
  });
});

describe("Admin Excel upload route", () => {
  it("rejects a non-Admin role with HTTP 403 before accessing the database", async () => {
    authenticateRequestMock.mockResolvedValue({ role: "user" });
    const response = await fetch(`${baseUrl}/api/admin/timetable/excel`, {
      method: "POST",
      headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "X-Requested-With": "RoomfinderAdmin" },
      body: new Uint8Array(createWorkbook()),
    });
    expect(response.status).toBe(403);
    expect(getDbMock).not.toHaveBeenCalled();
  });

  it("rejects an Admin request without the expected admin-page header with HTTP 403", async () => {
    authenticateRequestMock.mockResolvedValue({ role: "admin" });
    const response = await fetch(`${baseUrl}/api/admin/timetable/excel`, {
      method: "POST",
      headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
      body: new Uint8Array(createWorkbook()),
    });
    expect(response.status).toBe(403);
    expect(getDbMock).not.toHaveBeenCalled();
  });

  it("parses the original workbook on the server and transactionally upserts 80 timetable slots", async () => {
    authenticateRequestMock.mockResolvedValue({ role: "admin" });
    const harness = makeDbHarness();
    getDbMock.mockResolvedValue(harness.db);
    const response = await fetch(`${baseUrl}/api/admin/timetable/excel`, {
      method: "POST",
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "X-Requested-With": "RoomfinderAdmin",
      },
      body: new Uint8Array(createWorkbook()),
    });
    const result = await response.json() as { roomsProcessed: number; entriesProcessed: number; message: string };

    expect(response.status).toBe(200);
    expect(result).toMatchObject({ roomsProcessed: 1, entriesProcessed: 80 });
    expect(result.message).toContain("Database updated successfully!");
    expect(harness.db.transaction).toHaveBeenCalledOnce();
    expect(harness.operations.filter(operation => operation.kind === "upsert").map(operation => operation.table))
      .toEqual(["classrooms", "timetable_entries"]);
    expect(harness.operations.find(operation => operation.table === "timetable_entries" && operation.kind === "upsert")?.rows)
      .toHaveLength(80);
    expect(harness.operations.filter(operation => operation.kind === "delete")).toHaveLength(2);
    expect(harness.wasRolledBack()).toBe(false);
    console.info("[Local simulation] Excel upload success: server parsed Schedule.xlsx; UPSERT committed to mocked DB (1 room, 80 entries); shared Aiven was not modified.");
  });

  it("normalizes bracketed teacher text and filters excluded codes in an isolated Excel upload", async () => {
    authenticateRequestMock.mockResolvedValue({ role: "admin" });
    const harness = makeDbHarness();
    getDbMock.mockResolvedValue(harness.db);
    const response = await fetch(`${baseUrl}/api/admin/timetable/excel`, {
      method: "POST",
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "X-Requested-With": "RoomfinderAdmin",
      },
      body: new Uint8Array(createWorkbook({
        occupant: "Kouaho (guy) Gueye",
        occupantDisplay: "Xinyao (yoyo) Feng",
        staffCodes: "KG,XF,GM,YS,RK",
      })),
    });
    const entries = harness.operations.find(operation => operation.table === "timetable_entries" && operation.kind === "upsert")?.rows as Array<{
      week: string; day: string; period: string; occupant: string; occupantDisplay: string; staffCodes: string | null;
    }>;
    const imported = entries.find(entry => entry.week === "A" && entry.day === "Monday" && entry.period === "lesson1");

    expect(response.status).toBe(200);
    expect(imported).toMatchObject({
      occupant: "Kouaho (Guy) Gueye",
      occupantDisplay: "Xinyao (Yoyo) Feng",
      staffCodes: "KG,XF",
    });
    console.info("[Local simulation] Name-normalized Excel upload success: bracketed names canonicalized and excluded codes removed in mock-only UPSERT; shared Aiven was not modified.");
  });

  it("accepts a valid password session for Excel sync while keeping all database calls mocked", async () => {
    authenticateRequestMock.mockRejectedValue(new Error("No OAuth account session"));
    const harness = makeDbHarness();
    getDbMock.mockResolvedValue(harness.db);
    const login = await fetch(`${baseUrl}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: LOCAL_TEST_ADMIN_SECRET }),
    });
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const response = await fetch(`${baseUrl}/api/admin/timetable/excel`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "X-Requested-With": "RoomfinderAdmin",
      },
      body: new Uint8Array(createWorkbook()),
    });

    expect(response.status).toBe(200);
    expect(harness.operations.filter(operation => operation.kind === "upsert").map(operation => operation.table))
      .toEqual(["classrooms", "timetable_entries"]);
    expect(authenticateRequestMock).not.toHaveBeenCalled();
    console.info("[Local simulation] Password-authenticated Excel sync success: mock UPSERT committed; shared Aiven was not modified.");
  });

  it("returns 422 and performs no database write for an incomplete workbook", async () => {
    authenticateRequestMock.mockResolvedValue({ role: "admin" });
    const harness = makeDbHarness();
    getDbMock.mockResolvedValue(harness.db);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ Room: "A101", Week: "A", Day: "Monday", Period: "Lesson 1" }]), "Schedule");
    const response = await fetch(`${baseUrl}/api/admin/timetable/excel`, {
      method: "POST",
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "X-Requested-With": "RoomfinderAdmin",
      },
      body: new Uint8Array(XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }) as Buffer),
    });
    expect(response.status).toBe(422);
    expect(harness.db.transaction).not.toHaveBeenCalled();
  });

  it("logs a useful database error and reports a transaction rollback on UPSERT failure", async () => {
    authenticateRequestMock.mockResolvedValue({ role: "admin" });
    const harness = makeDbHarness(true);
    getDbMock.mockResolvedValue(harness.db);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const response = await fetch(`${baseUrl}/api/admin/timetable/excel`, {
        method: "POST",
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "X-Requested-With": "RoomfinderAdmin",
        },
        body: new Uint8Array(createWorkbook()),
      });
      expect(response.status).toBe(500);
      expect(harness.wasRolledBack()).toBe(true);
      expect(log).toHaveBeenCalledWith(
        "[Admin] Excel timetable transaction failed; the database transaction was rolled back.",
        expect.objectContaining({ code: "ER_TEST_WRITE", errno: 1234, sqlState: "HY000", message: "mocked timetable upsert failure" }),
      );
    } finally {
      log.mockRestore();
    }
  });
});
