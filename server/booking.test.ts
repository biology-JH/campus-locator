import { describe, expect, it } from "vitest";
import type { TrpcContext } from "./_core/context.js";
import { bookingRouter, isDuplicateBookingError } from "./booking.js";
import { scheduleSlotForDate, WeekAnchorNotConfiguredError } from "../shared/school-week.js";

function caller(sitePasswordSession: boolean) {
  const context = {
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
    user: null,
    adminPasswordSession: false,
    sitePasswordSession,
  } satisfies TrpcContext;
  return bookingRouter.createCaller(context);
}

describe("room booking authorization and conflict mapping", () => {
  it("rejects a guest without a verified shared SITE_PASSWORD session", async () => {
    await expect(caller(false).slotReservations({ date: "2026-10-27", period: "lesson1" }))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller(false).create({ date: "2026-10-27", period: "lesson1", roomId: 1, teacherName: "Teacher" }))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("fails closed until the calendar Week A anchor is verified", () => {
    expect(() => scheduleSlotForDate("2026-10-27", "lesson1", null))
      .toThrow(WeekAnchorNotConfiguredError);
  });

  it("maps MySQL unique-index collisions to a room-slot conflict", () => {
    expect(isDuplicateBookingError({ code: "ER_DUP_ENTRY", errno: 1062 })).toBe(true);
    expect(isDuplicateBookingError({ cause: { errno: 1062 } })).toBe(true);
    expect(isDuplicateBookingError({ code: "ER_ACCESS_DENIED_ERROR" })).toBe(false);
  });
});
