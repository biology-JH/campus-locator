import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BOOKINGS_MIGRATION_CONTENT,
  ensureBookingsSchema,
} from "./bookings-schema.js";

afterEach(() => vi.restoreAllMocks());

describe("bookings schema migration", () => {
  it("matches the checked-in additive migration bytes and journal order", async () => {
    const file = await readFile(new URL("../drizzle/0003_add_bookings.sql", import.meta.url), "utf8");
    expect(BOOKINGS_MIGRATION_CONTENT).toBe(file);
    expect(file).toContain("CONSTRAINT `booking_room_slot_unique` UNIQUE (`room_id`,`schedule_week`,`weekday`,`class_period`)");
    expect(file).toContain("CREATE TABLE IF NOT EXISTS `bookings`");
    expect(file).toContain("FOREIGN KEY (`room_id`) REFERENCES `classrooms`(`id`)");
  });

  it("creates only the additive bookings table once per database object", async () => {
    const db = { execute: vi.fn().mockResolvedValue(undefined) };

    await ensureBookingsSchema(db as never);
    await ensureBookingsSchema(db as never);

    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(BOOKINGS_MIGRATION_CONTENT).toContain("booking_room_slot_unique");
    expect(BOOKINGS_MIGRATION_CONTENT).not.toMatch(/DROP\s+TABLE|DELETE\s+FROM/i);
  });

  it("allows a retry if the first migration attempt fails", async () => {
    const db = {
      execute: vi.fn()
        .mockRejectedValueOnce(Object.assign(new Error("not surfaced"), { code: "ER_TEST" }))
        .mockResolvedValue(undefined),
    };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(ensureBookingsSchema(db as never)).rejects.toThrow(/temporarily unavailable/);
    await ensureBookingsSchema(db as never);

    expect(db.execute).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalledWith("[Bookings] Schema initialization failed (ER_TEST).");
  });
});
