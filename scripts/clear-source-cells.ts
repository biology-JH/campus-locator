import "dotenv/config";
import { createPool } from "mysql2/promise";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import suppressions from "../server/data/timetable-cell-suppressions.json";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to clear the explicitly selected source cells.");
}

const pool = createPool(databaseUrl);

type CellRow = RowDataPacket & { occupant: string | null };

async function clearSourceCells() {
  const connection = await pool.getConnection();
  let cleared = 0;
  let alreadyFree = 0;

  try {
    await connection.beginTransaction();
    for (const cell of suppressions) {
      const [rows] = await connection.query<CellRow[]>(
        `SELECT occupant FROM timetable_entries
         WHERE roomNumber = ? AND week = ? AND day = ? AND period = ?
         FOR UPDATE`,
        [cell.room, cell.week, cell.day, cell.period],
      );
      if (rows.length !== 1) {
        throw new Error(`Expected one record for ${cell.room} ${cell.week} ${cell.day} ${cell.period}.`);
      }

      const current = rows[0]?.occupant ?? null;
      if (current === null) {
        alreadyFree += 1;
        continue;
      }
      if (current !== cell.sourceText) {
        throw new Error(`Source text changed for ${cell.room} ${cell.week} ${cell.day} ${cell.period}; refusing to overwrite it.`);
      }

      const [result] = await connection.query<ResultSetHeader>(
        `UPDATE timetable_entries
         SET occupant = NULL, occupantDisplay = NULL, staffCodes = NULL
         WHERE roomNumber = ? AND week = ? AND day = ? AND period = ? AND occupant = ?`,
        [cell.room, cell.week, cell.day, cell.period, cell.sourceText],
      );
      if (result.affectedRows !== 1) {
        throw new Error(`Expected one updated record for ${cell.room} ${cell.week} ${cell.day} ${cell.period}.`);
      }
      cleared += 1;
    }
    await connection.commit();
    console.log(`Cleared ${cleared} source-artifact cells; ${alreadyFree} were already Free.`);
  } catch (error) {
    await connection.rollback();
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
