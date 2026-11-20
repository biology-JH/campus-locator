import { describe, expect, it } from "vitest";
import type { TrpcContext } from "./_core/context.js";
import { bookingRouter, bookingTeacherNames, canonicalBookingTeacherName, isDuplicateBookingError } from "./booking.js";
import { publicTeacherNames } from "./timetable.js";
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
    await expect(caller(false).teacherList())
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller(false).slotReservations({ date: "2026-10-27", period: "lesson1" }))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller(false).create({ date: "2026-10-27", period: "lesson1", roomId: 1, teacherName: "Guest" }))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("exposes Guest only in the password-protected booking name list", async () => {
    expect(publicTeacherNames()).not.toContain("Guest");
    expect(bookingTeacherNames()).toContain("Guest");
    await expect(caller(true).teacherList()).resolves.toContain("Guest");
  });

  it("canonicalizes Guest as an accepted booking name", () => {
    expect(canonicalBookingTeacherName("Guest")).toBe("Guest");
    expect(canonicalBookingTeacherName("guest")).toBe("Guest");
    expect(canonicalBookingTeacherName("Not a staff member")).toBe("");
  });

  it("fails closed until the calendar Week A anchor is verified", () => {
    expect(() => scheduleSlotForDate("2026-10-27", "lesson1", null))
      .toThrow(WeekAnchorNotConfiguredError);
  });

  it("maps PostgreSQL unique-index collisions to a room-slot conflict", () => {
    expect(isDuplicateBookingError({ code: "23505" })).toBe(true);
    expect(isDuplicateBookingError({ cause: { code: "23505" } })).toBe(true);
    expect(isDuplicateBookingError({ code: "08006" })).toBe(false);
  });
});
