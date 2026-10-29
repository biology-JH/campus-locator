import { createHash } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { PERIODS, EXCLUDED_ROOM_NUMBERS } from "../shared/timetable.js";
import {
  SCHOOL_WEEK_CYCLE_ANCHOR,
  scheduleSlotForDate,
  WeekAnchorNotConfiguredError,
} from "../shared/school-week.js";
import { capitalizeBracketedNames } from "../shared/teacher-names.js";
import { bookings, classrooms, timetableEntries } from "../drizzle/schema.js";
import { getDb } from "./db.js";
import { publicTeacherNames } from "./timetable.js";
import { ensureBookingsSchema } from "./bookings-schema.js";
import { router, sitePasswordProcedure } from "./_core/trpc.js";

const dateInput = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a calendar date in YYYY-MM-DD format.");
const periodInput = z.enum(["mentor", "lesson1", "lesson2", "lesson3", "lesson4", "lesson5", "lesson6", "lesson7"]);
const roomIdInput = z.number().int().positive();
const teacherNameInput = z.string().trim().min(2).max(160);
const excludedRooms = new Set<string>(EXCLUDED_ROOM_NUMBERS);

async function requireDatabase() {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The classroom timetable database is not configured.",
    });
  }
  return db;
}

function resolveCalendarSlot(date: string, period: z.infer<typeof periodInput>) {
  try {
    return scheduleSlotForDate(date, period, SCHOOL_WEEK_CYCLE_ANCHOR);
  } catch (error) {
    if (error instanceof WeekAnchorNotConfiguredError) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Room booking is paused until the school's Week A calendar anchor is verified.",
      });
    }
    if (error instanceof RangeError) {
      throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
    }
    throw error;
  }
}

function stableTeacherId(name: string): string {
  return createHash("sha256").update(name.trim().toLocaleLowerCase("en")).digest("hex").slice(0, 32);
}

export function isDuplicateBookingError(error: unknown): boolean {
  const pending: unknown[] = [error];
  const seen = new Set<object>();
  while (pending.length > 0) {
    const candidate = pending.pop();
    if (!candidate || typeof candidate !== "object" || seen.has(candidate)) continue;
    seen.add(candidate);
    const value = candidate as { code?: unknown; errno?: unknown; cause?: unknown };
    if (value.code === "ER_DUP_ENTRY" || value.errno === 1062) return true;
    if (value.cause) pending.push(value.cause);
  }
  return false;
}

function safeDatabaseErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function canonicalTeacherName(candidate: string): string {
  const normalized = capitalizeBracketedNames(candidate.trim());
  return publicTeacherNames().find(name => name.toLocaleLowerCase("en") === normalized.toLocaleLowerCase("en")) ?? "";
}

export const bookingRouter = router({
  slotReservations: sitePasswordProcedure
    .input(z.object({ date: dateInput, period: periodInput }).strict())
    .query(async ({ input }) => {
      const db = await requireDatabase();
      await ensureBookingsSchema(db);
      const slot = resolveCalendarSlot(input.date, input.period);

      const reservations = await db
        .select({
          id: bookings.id,
          roomId: bookings.roomId,
          roomNumber: classrooms.roomNumber,
          teacherId: bookings.teacherId,
          teacherName: bookings.teacherName,
          createdAt: bookings.createdAt,
        })
        .from(bookings)
        .innerJoin(classrooms, eq(bookings.roomId, classrooms.id))
        .where(and(
          eq(bookings.scheduleWeek, slot.scheduleWeek),
          eq(bookings.weekday, slot.weekday),
          eq(bookings.classPeriod, input.period),
        ))
        .orderBy(asc(classrooms.displayOrder));

      return {
        ...slot,
        period: input.period,
        periodLabel: PERIODS.find(period => period.id === input.period)?.label ?? input.period,
        reservations,
      };
    }),

  create: sitePasswordProcedure
    .input(z.object({
      date: dateInput,
      period: periodInput,
      roomId: roomIdInput,
      teacherName: teacherNameInput,
    }).strict())
    .mutation(async ({ input }) => {
      const db = await requireDatabase();
      await ensureBookingsSchema(db);
      const slot = resolveCalendarSlot(input.date, input.period);

      const teacherName = canonicalTeacherName(input.teacherName);
      if (!teacherName) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Select a teacher from the current staff list." });
      }

      const [room] = await db
        .select({ id: classrooms.id, roomNumber: classrooms.roomNumber })
        .from(classrooms)
        .where(eq(classrooms.id, input.roomId))
        .limit(1);
      if (!room || excludedRooms.has(room.roomNumber)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Select a valid, bookable room." });
      }

      const [scheduleEntry] = await db
        .select({ occupant: timetableEntries.occupant })
        .from(timetableEntries)
        .where(and(
          eq(timetableEntries.roomNumber, room.roomNumber),
          eq(timetableEntries.week, slot.scheduleWeek),
          eq(timetableEntries.day, slot.weekday),
          eq(timetableEntries.period, input.period),
        ))
        .limit(1);
      if (!scheduleEntry) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The room's timetable slot is incomplete; this room cannot be booked safely." });
      }
      const roomIsOccupied = typeof scheduleEntry.occupant === "string" && scheduleEntry.occupant.trim().length > 0;
      if (roomIsOccupied) {
        throw new TRPCError({ code: "CONFLICT", message: "This room is occupied in the school timetable for that recurring slot." });
      }

      try {
        await db.insert(bookings).values({
          roomId: room.id,
          teacherId: stableTeacherId(teacherName),
          teacherName,
          scheduleWeek: slot.scheduleWeek,
          weekday: slot.weekday,
          classPeriod: input.period,
        });
      } catch (error) {
        if (isDuplicateBookingError(error)) {
          throw new TRPCError({ code: "CONFLICT", message: "That room is already booked for this Week A/B day and period." });
        }
        console.error(`[Bookings] Reservation insert failed${safeDatabaseErrorCode(error) ? ` (${safeDatabaseErrorCode(error)})` : ""}.`);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The booking could not be saved. Please try again." });
      }

      return {
        roomNumber: room.roomNumber,
        teacherName,
        ...slot,
        period: input.period,
      };
    }),
});
