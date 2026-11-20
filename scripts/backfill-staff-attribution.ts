import dotenv from "dotenv";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { Day, PeriodId, Week } from "../shared/timetable";
import timetableData from "../server/data/timetable.json";
import { timetableEntries } from "../drizzle/schema";

dotenv.config({ path: [".env.local", ".env"] });

const connectionString = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL_UNPOOLED or DATABASE_URL is required to backfill staff attribution.");
}

const pool = new Pool({ connectionString });
const db = drizzle(pool);
const chunkSize = 200;

async function backfill() {
  const rows = timetableData.rooms.flatMap(room =>
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

  try {
    await db.transaction(async tx => {
      for (let index = 0; index < rows.length; index += chunkSize) {
        const batch = rows.slice(index, index + chunkSize);
        await tx.insert(timetableEntries).values(batch).onConflictDoUpdate({
          target: [timetableEntries.roomNumber, timetableEntries.week, timetableEntries.day, timetableEntries.period],
          set: {
            occupantDisplay: sql`excluded."occupantDisplay"`,
            staffCodes: sql`excluded."staffCodes"`,
          },
        });
      }
    });
    console.log(`Backfilled staff attribution for ${rows.length} source timetable cells.`);
  } finally {
    await pool.end();
  }
}

backfill().catch(error => {
  console.error("Staff attribution backfill failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
