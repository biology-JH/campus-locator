import { sql } from "drizzle-orm";
import type { getDb } from "./db.js";

type BookingDatabase = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/** Keep this exact SQL in sync with drizzle/0003_add_bookings.sql. */
export const BOOKINGS_MIGRATION_CONTENT = [
  "CREATE TABLE IF NOT EXISTS `bookings` (",
  "  `id` int AUTO_INCREMENT NOT NULL,",
  "  `room_id` int NOT NULL,",
  "  `teacher_id` varchar(64) NOT NULL,",
  "  `teacher_name` varchar(160) NOT NULL,",
  "  `schedule_week` enum('A','B') NOT NULL,",
  "  `weekday` enum('Monday','Tuesday','Wednesday','Thursday','Friday') NOT NULL,",
  "  `class_period` enum('mentor','lesson1','lesson2','lesson3','lesson4','lesson5','lesson6','lesson7') NOT NULL,",
  "  `created_at` timestamp NOT NULL DEFAULT (now()),",
  "  CONSTRAINT `bookings_id` PRIMARY KEY (`id`),",
  "  CONSTRAINT `booking_room_slot_unique` UNIQUE (`room_id`,`schedule_week`,`weekday`,`class_period`),",
  "  INDEX `booking_slot_lookup_idx` (`schedule_week`,`weekday`,`class_period`),",
  "  CONSTRAINT `bookings_room_id_classrooms_id_fk` FOREIGN KEY (`room_id`) REFERENCES `classrooms`(`id`) ON DELETE cascade ON UPDATE no action",
  ");",
].join("\n") + "\n";

const initializedDatabases = new WeakSet<object>();
const inFlightMigrations = new WeakMap<object, Promise<void>>();

async function applyBookingsMigration(db: BookingDatabase): Promise<void> {
  // MySQL DDL auto-commits; CREATE TABLE IF NOT EXISTS is safe across concurrent serverless instances.
  // The checked-in Drizzle migration records normal migration history when the CLI is run later.
  await db.execute(sql.raw(BOOKINGS_MIGRATION_CONTENT));
}

/** Apply the one-table additive schema operation once per process/database object. */
export async function ensureBookingsSchema(db: BookingDatabase): Promise<void> {
  const key = db as object;
  if (initializedDatabases.has(key)) return;

  const pending = inFlightMigrations.get(key);
  if (pending) {
    await pending;
    return;
  }

  const migration = applyBookingsMigration(db);
  inFlightMigrations.set(key, migration);
  try {
    await migration;
    initializedDatabases.add(key);
  } catch (error) {
    const code = error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
    console.error(`[Bookings] Schema initialization failed${typeof code === "string" ? ` (${code})` : ""}.`);
    throw new Error("Room booking storage is temporarily unavailable.");
  } finally {
    inFlightMigrations.delete(key);
  }
}
