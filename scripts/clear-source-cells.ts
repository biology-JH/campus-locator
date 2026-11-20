import dotenv from "dotenv";
import { Pool } from "pg";
import suppressions from "../server/data/timetable-cell-suppressions.json";

dotenv.config({ path: [".env.local", ".env"] });

const connectionString = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL_UNPOOLED or DATABASE_URL is required to clear the explicitly selected source cells.");
}

const pool = new Pool({ connectionString });

async function clearSourceCells() {
  const connection = await pool.connect();
  let cleared = 0;
  let alreadyFree = 0;

  try {
    await connection.query("BEGIN");
    for (const cell of suppressions) {
      const result = await connection.query<{ occupant: string | null }>(
        `SELECT "occupant" FROM "timetable_entries"
         WHERE "roomNumber" = $1 AND "week" = $2 AND "day" = $3 AND "period" = $4
         FOR UPDATE`,
        [cell.room, cell.week, cell.day, cell.period],
      );
      if (result.rows.length !== 1) {
        throw new Error(`Expected one record for ${cell.room} ${cell.week} ${cell.day} ${cell.period}.`);
      }

      const current = result.rows[0]?.occupant ?? null;
      if (current === null) {
        alreadyFree += 1;
        continue;
      }
      if (current !== cell.sourceText) {
        throw new Error(`Source text changed for ${cell.room} ${cell.week} ${cell.day} ${cell.period}; refusing to overwrite it.`);
      }

      const update = await connection.query(
        `UPDATE "timetable_entries"
         SET "occupant" = NULL, "occupantDisplay" = NULL, "staffCodes" = NULL
         WHERE "roomNumber" = $1 AND "week" = $2 AND "day" = $3 AND "period" = $4 AND "occupant" = $5`,
        [cell.room, cell.week, cell.day, cell.period, cell.sourceText],
      );
      if (update.rowCount !== 1) {
        throw new Error(`Expected one updated record for ${cell.room} ${cell.week} ${cell.day} ${cell.period}.`);
      }
      cleared += 1;
    }
    await connection.query("COMMIT");
    console.log(`Cleared ${cleared} source-artifact cells; ${alreadyFree} were already Free.`);
  } catch (error) {
    await connection.query("ROLLBACK");
    throw error;
  } finally {
    connection.release();
    await pool.end();
  }
}

clearSourceCells().catch(error => {
  console.error("Source-cell cleanup failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
