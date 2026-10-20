import "dotenv/config";
import { createPool } from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import type { Day, PeriodId, Week } from "../shared/timetable";
import timetableData from "../server/data/timetable.json";
import { classrooms, timetableEntries } from "../drizzle/schema";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to seed the timetable.");
}

const pool = createPool(databaseUrl);
const db = drizzle(pool);
const chunkSize = 400;

async function seed() {
  try {
    const [existingRooms, existingEntries] = await Promise.all([
      db.select({ roomNumber: classrooms.roomNumber }).from(classrooms).limit(1),
      db.select({ id: timetableEntries.id }).from(timetableEntries).limit(1),
    ]);

    if (existingRooms.length > 0 || existingEntries.length > 0) {
      throw new Error(
        "Seed stopped because classroom or timetable records already exist; no existing data was changed.",
      );
    }

    const roomValues = timetableData.rooms.map((room, displayOrder) => ({
      roomNumber: room.room,
      sourcePage: room.page,
      displayOrder,
    }));
    const entryValues = timetableData.rooms.flatMap(room =>
      room.schedule.map(cell => ({
        roomNumber: room.room,
        week: cell.week as Week,
        day: cell.day as Day,
        period: cell.period as PeriodId,
        occupant: cell.occupant,
        occupantDisplay: cell.occupantDisplay,
        staffCodes: cell.staffCodes.join(",") || null,
        sourcePage: room.page,
      })),
    );

    await db.transaction(async tx => {
      for (let index = 0; index < roomValues.length; index += chunkSize) {
        await tx.insert(classrooms).values(roomValues.slice(index, index + chunkSize));
      }
      for (let index = 0; index < entryValues.length; index += chunkSize) {
        await tx.insert(timetableEntries).values(entryValues.slice(index, index + chunkSize));
      }
    });

    console.log(
      `Imported ${roomValues.length} classrooms and ${entryValues.length} timetable cells from ${timetableData.sourceFile}.`,
    );
  } finally {
    await pool.end();
  }
}

seed().catch(error => {
  console.error("Timetable import failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
