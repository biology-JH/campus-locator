CREATE TYPE "public"."class_period" AS ENUM('mentor', 'lesson1', 'lesson2', 'lesson3', 'lesson4', 'lesson5', 'lesson6', 'lesson7');--> statement-breakpoint
CREATE TYPE "public"."day" AS ENUM('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday');--> statement-breakpoint
CREATE TYPE "public"."period" AS ENUM('mentor', 'lesson1', 'lesson2', 'lesson3', 'lesson4', 'lesson5', 'lesson6', 'lesson7');--> statement-breakpoint
CREATE TYPE "public"."schedule_week" AS ENUM('A', 'B');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TYPE "public"."week" AS ENUM('A', 'B');--> statement-breakpoint
CREATE TYPE "public"."weekday" AS ENUM('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday');--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" serial PRIMARY KEY NOT NULL,
	"room_id" integer NOT NULL,
	"teacher_id" varchar(64) NOT NULL,
	"teacher_name" varchar(160) NOT NULL,
	"schedule_week" "schedule_week" NOT NULL,
	"weekday" "weekday" NOT NULL,
	"class_period" "class_period" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "classrooms" (
	"id" serial PRIMARY KEY NOT NULL,
	"roomNumber" varchar(64) NOT NULL,
	"sourcePage" integer NOT NULL,
	"displayOrder" integer NOT NULL,
	CONSTRAINT "classrooms_roomNumber_unique" UNIQUE("roomNumber")
);
--> statement-breakpoint
CREATE TABLE "timetable_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"roomNumber" varchar(64) NOT NULL,
	"week" "week" NOT NULL,
	"day" "day" NOT NULL,
	"period" "period" NOT NULL,
	"occupant" text,
	"occupantDisplay" text,
	"staffCodes" text,
	"sourcePage" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"openId" varchar(64) NOT NULL,
	"name" text,
	"email" varchar(320),
	"loginMethod" varchar(64),
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"lastSignedIn" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_openId_unique" UNIQUE("openId")
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_room_id_classrooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."classrooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_roomNumber_classrooms_roomNumber_fk" FOREIGN KEY ("roomNumber") REFERENCES "public"."classrooms"("roomNumber") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "booking_room_slot_unique" ON "bookings" USING btree ("room_id","schedule_week","weekday","class_period");--> statement-breakpoint
CREATE INDEX "booking_slot_lookup_idx" ON "bookings" USING btree ("schedule_week","weekday","class_period");--> statement-breakpoint
CREATE INDEX "classrooms_display_order_idx" ON "classrooms" USING btree ("displayOrder");--> statement-breakpoint
CREATE UNIQUE INDEX "timetable_room_slot_unique" ON "timetable_entries" USING btree ("roomNumber","week","day","period");--> statement-breakpoint
CREATE INDEX "timetable_availability_idx" ON "timetable_entries" USING btree ("week","day","period");