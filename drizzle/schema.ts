import { index, int, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/** All classrooms appearing in the supplied aSc summary timetable. */
export const classrooms = mysqlTable(
  "classrooms",
  {
    id: int("id").autoincrement().primaryKey(),
    roomNumber: varchar("roomNumber", { length: 64 }).notNull().unique(),
    sourcePage: int("sourcePage").notNull(),
    displayOrder: int("displayOrder").notNull(),
  },
  table => ({
    displayOrderIndex: index("classrooms_display_order_idx").on(table.displayOrder),
  }),
);

/** One normalized record per room, alternating week, weekday, and requested period. */
export const timetableEntries = mysqlTable(
  "timetable_entries",
  {
    id: int("id").autoincrement().primaryKey(),
    roomNumber: varchar("roomNumber", { length: 64 })
      .notNull()
      .references(() => classrooms.roomNumber, { onDelete: "cascade" }),
    week: mysqlEnum("week", ["A", "B"]).notNull(),
    day: mysqlEnum("day", ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]).notNull(),
    period: mysqlEnum("period", ["mentor", "lesson1", "lesson2", "lesson3", "lesson4", "lesson5", "lesson6", "lesson7"]).notNull(),
    /** Exact abbreviated text extracted from the source PDF; null means explicitly vacant. */
    occupant: text("occupant"),
    /** Display text with uniquely resolved staff abbreviations removed; class/group data is kept. */
    occupantDisplay: text("occupantDisplay"),
    /** Comma-separated teacher abbreviation codes matched to this timetable cell. */
    staffCodes: text("staffCodes"),
    sourcePage: int("sourcePage").notNull(),
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
