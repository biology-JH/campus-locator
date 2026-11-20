import { describe, expect, it, vi } from "vitest";
import { ensureBookingsSchema } from "./bookings-schema.js";

function makeDatabase() {
  const limit = vi.fn().mockResolvedValue([]);
  const from = vi.fn().mockReturnValue({ limit });
  const select = vi.fn().mockReturnValue({ from });
  return { db: { select }, select, from, limit };
}

describe("PostgreSQL bookings schema verification", () => {
  it("checks the migrated bookings table once per database object", async () => {
    const mock = makeDatabase();

    await ensureBookingsSchema(mock.db as never);
    await ensureBookingsSchema(mock.db as never);

    expect(mock.select).toHaveBeenCalledTimes(1);
    expect(mock.from).toHaveBeenCalledTimes(1);
    expect(mock.limit).toHaveBeenCalledWith(0);
  });

  it("allows a retry if the first table verification fails", async () => {
    const mock = makeDatabase();
    mock.limit.mockRejectedValueOnce(Object.assign(new Error("not surfaced"), { code: "42P01" }));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(ensureBookingsSchema(mock.db as never)).rejects.toThrow(/temporarily unavailable/);
    await ensureBookingsSchema(mock.db as never);

    expect(mock.select).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalledWith("[Bookings] PostgreSQL schema verification failed (42P01).");
    errorSpy.mockRestore();
  });
});
