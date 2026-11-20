import type { getDb } from "./db.js";
import { bookings } from "../drizzle/schema.js";

type BookingDatabase = NonNullable<Awaited<ReturnType<typeof getDb>>>;

const initializedDatabases = new WeakSet<object>();
const inFlightChecks = new WeakMap<object, Promise<void>>();

async function verifyBookingsTable(db: BookingDatabase): Promise<void> {
  await db.select({ id: bookings.id }).from(bookings).limit(0);
}

/** Verify the migrated bookings table once per process/database object. */
export async function ensureBookingsSchema(db: BookingDatabase): Promise<void> {
  const key = db as object;
  if (initializedDatabases.has(key)) return;

  const pending = inFlightChecks.get(key);
  if (pending) {
    await pending;
    return;
  }

  const check = verifyBookingsTable(db);
  inFlightChecks.set(key, check);
  try {
    await check;
    initializedDatabases.add(key);
  } catch (error) {
    const code = error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
    console.error(`[Bookings] PostgreSQL schema verification failed${typeof code === "string" ? ` (${code})` : ""}.`);
    throw new Error("Room booking storage is temporarily unavailable.");
  } finally {
    inFlightChecks.delete(key);
  }
}
