import "dotenv/config";
import { createPool } from "mysql2/promise";
import type { Day, PeriodId, Week } from "../shared/timetable";
import timetableData from "../server/data/timetable.json";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to backfill staff attribution.");
}

const pool = createPool(databaseUrl);
const chunkSize = 200;

type BackfillRow = [string, Week, Day, PeriodId, string | null, string | null, string | null, number];

async function backfill() {
  const rows: BackfillRow[] = timetableData.rooms.flatMap(room =>
    room.schedule.map((cell): BackfillRow => [
      room.room,
      cell.week as Week,
      cell.day as Day,
      cell.period as PeriodId,
      cell.occupant,
      cell.occupantDisplay,
      cell.staffCodes.join(",") || null,
      room.page,
    ]),
  );
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    for (let index = 0; index < rows.length; index += chunkSize) {
      const batch = rows.slice(index, index + chunkSize);
      await connection.query(
        `INSERT INTO timetable_entries
          (roomNumber, week, day, period, occupant, occupantDisplay, staffCodes, sourcePage)
         VALUES ?
         ON DUPLICATE KEY UPDATE
          occupantDisplay = VALUES(occupantDisplay),
          staffCodes = VALUES(staffCodes)`,
        [batch],
      );
    }
    await connection.commit();
    console.log(`Backfilled staff attribution for ${rows.length} source timetable cells.`);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
    await pool.end();
  }
}

backfill().catch(error => {
  console.error("Staff attribution backfill failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
