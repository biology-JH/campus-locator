import {
  index,
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["user", "admin"]);
export const weekEnum = pgEnum("week", ["A", "B"]);
export const dayEnum = pgEnum("day", ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]);
export const periodEnum = pgEnum("period", ["mentor", "lesson1", "lesson2", "lesson3", "lesson4", "lesson5", "lesson6", "lesson7"]);
export const scheduleWeekEnum = pgEnum("schedule_week", ["A", "B"]);
export const weekdayEnum = pgEnum("weekday", ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]);
export const classPeriodEnum = pgEnum("class_period", ["mentor", "lesson1", "lesson2", "lesson3", "lesson4", "lesson5", "lesson6", "lesson7"]);

/** Core user table backing the existing authentication flow. */
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: userRoleEnum("role").default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/** All classrooms appearing in the supplied aSc summary timetable. */
export const classrooms = pgTable(
  "classrooms",
  {
    id: serial("id").primaryKey(),
    roomNumber: varchar("roomNumber", { length: 64 }).notNull().unique(),
    sourcePage: integer("sourcePage").notNull(),
    displayOrder: integer("displayOrder").notNull(),
  },
  table => ({
    displayOrderIndex: index("classrooms_display_order_idx").on(table.displayOrder),
  }),
);

/** One normalized record per room, alternating week, weekday, and requested period. */
export const timetableEntries = pgTable(
  "timetable_entries",
  {
    id: serial("id").primaryKey(),
    roomNumber: varchar("roomNumber", { length: 64 })
      .notNull()
      .references(() => classrooms.roomNumber, { onDelete: "cascade" }),
    week: weekEnum("week").notNull(),
    day: dayEnum("day").notNull(),
    period: periodEnum("period").notNull(),
    /** Exact abbreviated text extracted from the source; null means explicitly vacant. */
    occupant: text("occupant"),
    /** Display text with uniquely resolved staff abbreviations removed; class/group data is kept. */
    occupantDisplay: text("occupantDisplay"),
    /** Comma-separated teacher abbreviation codes matched to this timetable cell. */
    staffCodes: text("staffCodes"),
    sourcePage: integer("sourcePage").notNull(),
  },
  table => ({
    roomSlotUnique: uniqueIndex("timetable_room_slot_unique").on(
      table.roomNumber,
      table.week,
      table.day,
      table.period,
    ),
    availabilityIndex: index("timetable_availability_idx").on(table.week, table.day, table.period),
  }),
);

export type Classroom = typeof classrooms.$inferSelect;
export type TimetableEntry = typeof timetableEntries.$inferSelect;

/** A recurring reservation for one classroom and one alternating timetable slot. */
export const bookings = pgTable(
  "bookings",
  {
    id: serial("id").primaryKey(),
    roomId: integer("room_id")
      .notNull()
      .references(() => classrooms.id, { onDelete: "cascade" }),
    teacherId: varchar("teacher_id", { length: 64 }).notNull(),
    teacherName: varchar("teacher_name", { length: 160 }).notNull(),
    scheduleWeek: scheduleWeekEnum("schedule_week").notNull(),
    weekday: weekdayEnum("weekday").notNull(),
    classPeriod: classPeriodEnum("class_period").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  table => ({
    roomSlotUnique: uniqueIndex("booking_room_slot_unique").on(
      table.roomId,
      table.scheduleWeek,
      table.weekday,
      table.classPeriod,
    ),
    slotLookupIndex: index("booking_slot_lookup_idx").on(
      table.scheduleWeek,
      table.weekday,
      table.classPeriod,
    ),
  }),
);

export type Booking = typeof bookings.$inferSelect;
export type InsertBooking = typeof bookings.$inferInsert;
