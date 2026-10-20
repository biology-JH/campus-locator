import { TRPCError } from "@trpc/server";
import { and, asc, eq, notInArray } from "drizzle-orm";
import { z } from "zod";
import { DAYS, EXCLUDED_ROOM_NUMBERS, PERIODS, WEEKS } from "../shared/timetable.js";
import { getDb } from "./db.js";
import { classrooms, timetableEntries } from "../drizzle/schema.js";
import { publicProcedure, router } from "./_core/trpc.js";
import { staffForCodes } from "./staff-resolution.js";
import { formatSubjectDisplay } from "./subject-resolution.js";
import teacherAbbreviations from "./data/teacher-abbreviations.json" with { type: "json" };

const weekInput = z.enum(WEEKS);
const dayInput = z.enum(DAYS);
const periodInput = z.enum([
  "mentor",
  "lesson1",
  "lesson2",
  "lesson3",
  "lesson4",
  "lesson5",
  "lesson6",
  "lesson7",
]);
const HIDDEN_STAFF_TERMS = ["external cover 1", "external cover 2", "yvonne au", "yuki"];
const isHiddenStaffName = (name: string) => HIDDEN_STAFF_TERMS.some(term => name.toLocaleLowerCase().includes(term));
const visibleStaffAttributions = <T extends { names: string[] }>(staff: T[]) => staff
  .map(attribution => ({ ...attribution, names: attribution.names.filter(name => !isHiddenStaffName(name)) }))
  .filter(attribution => attribution.names.length > 0);

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

export const timetableRouter = router({
  roomList: publicProcedure.query(async () => {
    const db = await requireDatabase();
    return db
      .select({ roomNumber: classrooms.roomNumber, sourcePage: classrooms.sourcePage })
      .from(classrooms)
      .where(notInArray(classrooms.roomNumber, [...EXCLUDED_ROOM_NUMBERS]))
      .orderBy(asc(classrooms.displayOrder));
  }),

  teacherList: publicProcedure.query(() => {
    const names = new Set<string>();
    for (const people of Object.values(teacherAbbreviations.byCode)) {
      for (const person of people) if (!isHiddenStaffName(person.displayName)) names.add(person.displayName);
    }
    return [...names].sort((left, right) => left.localeCompare(right));
  }),

  availability: publicProcedure
    .input(z.object({ week: weekInput, day: dayInput, period: periodInput }))
    .query(async ({ input }) => {
      const db = await requireDatabase();
      const [roomRows, entryRows] = await Promise.all([
        db
          .select({ roomNumber: classrooms.roomNumber, sourcePage: classrooms.sourcePage })
          .from(classrooms)
          .where(notInArray(classrooms.roomNumber, [...EXCLUDED_ROOM_NUMBERS]))
          .orderBy(asc(classrooms.displayOrder)),
        db
          .select({ roomNumber: timetableEntries.roomNumber, occupant: timetableEntries.occupant })
          .from(timetableEntries)
          .where(
            and(
              eq(timetableEntries.week, input.week),
              eq(timetableEntries.day, input.day),
              eq(timetableEntries.period, input.period),
            ),
          ),
      ]);

      const entriesByRoom = new Map(entryRows.map(entry => [entry.roomNumber, entry.occupant]));
      const schedule = roomRows.map(room => {
        const hasRecord = entriesByRoom.has(room.roomNumber);
        const occupant = entriesByRoom.get(room.roomNumber) ?? null;
        return {
          ...room,
          occupant,
          hasRecord,
          isFree: hasRecord && !occupant,
          isOccupied: hasRecord && Boolean(occupant),
        };
      });

      return {
        selection: input,
        totalRooms: roomRows.length,
        freeRooms: schedule.filter(room => room.isFree),
        occupiedCount: schedule.filter(room => room.isOccupied).length,
        incompleteCount: schedule.filter(room => !room.hasRecord).length,
      };
    }),

  teacherLocations: publicProcedure
    .input(z.object({
      teacher: z.string().trim().min(2).max(120),
      week: weekInput,
      day: dayInput,
      period: periodInput,
    }))
    .query(async ({ input }) => {
      const db = await requireDatabase();
      const [roomRows, entryRows] = await Promise.all([
        db
          .select({ roomNumber: classrooms.roomNumber, displayOrder: classrooms.displayOrder })
          .from(classrooms)
          .where(notInArray(classrooms.roomNumber, [...EXCLUDED_ROOM_NUMBERS])),
        db
          .select({
            roomNumber: timetableEntries.roomNumber,
            occupant: timetableEntries.occupant,
            occupantDisplay: timetableEntries.occupantDisplay,
            staffCodes: timetableEntries.staffCodes,
          })
          .from(timetableEntries)
          .where(and(
            eq(timetableEntries.week, input.week),
            eq(timetableEntries.day, input.day),
            eq(timetableEntries.period, input.period),
          )),
      ]);
      const roomOrder = new Map(roomRows.map(room => [room.roomNumber, room.displayOrder]));
      const query = input.teacher.toLocaleLowerCase();
      const matches = entryRows.flatMap(entry => {
        const staff = visibleStaffAttributions(staffForCodes(
          entry.staffCodes,
          entry.occupant,
          input.period,
          { roomNumber: entry.roomNumber, week: input.week, day: input.day },
        ));
        return staff
          .filter(attribution => attribution.names.some(name => name.toLocaleLowerCase().includes(query)))
          .map(attribution => ({
            roomNumber: entry.roomNumber,
            teacher: attribution.names.find(name => name.toLocaleLowerCase().includes(query)) ?? input.teacher,
            week: input.week,
            day: input.day,
            period: input.period,
            periodLabel: PERIODS.find(period => period.id === input.period)?.label ?? input.period,
            occupant: entry.occupant,
            occupantDisplay: formatSubjectDisplay(entry.occupantDisplay ?? entry.occupant),
          }));
      }).sort((left, right) => (roomOrder.get(left.roomNumber) ?? 0) - (roomOrder.get(right.roomNumber) ?? 0));
      return { selection: input, matches };
    }),

  masterSchedule: publicProcedure
    .input(z.object({ roomNumber: z.string().trim().min(1).max(64) }))
    .query(async ({ input }) => {
      const db = await requireDatabase();
      const [room] = await db
        .select({ roomNumber: classrooms.roomNumber, sourcePage: classrooms.sourcePage })
        .from(classrooms)
        .where(
          and(
            eq(classrooms.roomNumber, input.roomNumber),
            notInArray(classrooms.roomNumber, [...EXCLUDED_ROOM_NUMBERS]),
          ),
        )
        .limit(1);

      if (!room) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Classroom not found." });
      }

      const entries = await db
        .select({
          week: timetableEntries.week,
          day: timetableEntries.day,
          period: timetableEntries.period,
          occupant: timetableEntries.occupant,
          occupantDisplay: timetableEntries.occupantDisplay,
          staffCodes: timetableEntries.staffCodes,
        })
        .from(timetableEntries)
        .where(eq(timetableEntries.roomNumber, room.roomNumber));
      const keyFor = (week: string, day: string, period: string) => `${week}|${day}|${period}`;
      const entryMap = new Map(entries.map(entry => [keyFor(entry.week, entry.day, entry.period), entry]));

      return {
        ...room,
        weeks: WEEKS.map(week => ({
          week,
          days: DAYS.map(day => ({
            day,
            slots: PERIODS.map(period => {
              const entry = entryMap.get(keyFor(week, day, period.id));
              return {
                period: period.id,
                label: period.label,
                occupant: entry?.occupant ?? null,
                occupantDisplay: formatSubjectDisplay(entry?.occupantDisplay ?? entry?.occupant ?? null),
                staff: visibleStaffAttributions(staffForCodes(entry?.staffCodes ?? null, entry?.occupant ?? null, period.id, {
                  roomNumber: room.roomNumber,
                  week,
                  day,
                })),
                hasRecord: Boolean(entry),
                isOccupied: Boolean(entry?.occupant),
              };
            }),
          })),
        })),
      };
    }),
});
