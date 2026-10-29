# Campus Locator — Room Booking System plan

## Scope

Extend the deployed YCIS Campus Locator in place. Preserve the existing React/Vite, Express/tRPC, Drizzle/MySQL stack, timetable, teacher search, schedule editor, shared SITE_PASSWORD gate, and Aiven connection. Add a recurring room-booking flow without changing existing timetable records or environment variables. Bookings are recurring Week A/B + weekday + period reservations because the requested schema contains no one-time booking date.

## Implementation approach

1. Add a new `bookings` MySQL table with an auto ID, `room_id` linked to `classrooms.id`, teacher name and a stable hashed teacher identifier, schedule week (`A`/`B`), weekday (Monday–Friday), class period (canonical period IDs), and creation timestamp. Enforce a unique constraint across room, schedule week, weekday, and period; this database constraint is the authoritative concurrent double-booking guard. Keep the migration additive and leave classrooms/timetable rows untouched.
2. Add a shared date-only week-cycle helper. The user confirmed the 2026–27 rules: Monday 2027-01-04 = Week A; Monday 2027-04-12 resets to Week A; the week containing 2027-06-01 = Week B; the school week beginning Monday 2027-06-07 is skipped; and Monday 2027-06-14 resets to Week A. Keep Monday–Friday as the bookable weekdays and alternate A/B between these explicit school reset points without timezone/DST drift. Derive weekday and Week A/B on the server from the submitted date rather than trusting client-supplied labels. The supplied workbook has no explicit A/B labels, so these markers come from the user.
3. Add booking APIs behind a server-verified SITE_PASSWORD session procedure. Read reservations for a selected date/period, validate room and teacher against current room/staff data, derive the recurring schedule slot, and return a clear conflict when the database uniqueness constraint rejects a duplicate. Keep existing public health and unrelated timetable routes unchanged.
4. Add a fourth `Room Booking` view to the existing Home dashboard. Reuse the site's editorial school-operations visual system and canonical room/teacher/period lists. Let teachers select a calendar date, room, teacher, and period; show the derived weekday and Week A/B; mark rooms already booked for that recurring slot; list the current reservations; and explain that a reservation repeats for its Week A/B slot. Provide prominent `This Week` and `Next Week` shortcuts with calculated Week A/B labels, and retain the native date picker so teachers can jump to any later date/month in the term using the same school reset/skip rules.
5. Test date-boundary/parity validation, SITE_PASSWORD authorization, invalid fields, and duplicate-key conflict mapping; assert the database's unique index from the migration. Run the existing test suite, TypeScript check, and production build. Use the existing Aiven connection for the one-table additive `CREATE TABLE IF NOT EXISTS` migration on the first authenticated booking API call; do not print or change credentials. Commit the code to GitHub `main` and verify the Vercel deployment build.

## Project structure

- `client/src/pages/Home.tsx`: existing dashboard navigation and booking form view.
- `client/src/index.css`: existing design tokens/responsive panel styles plus booking-specific styles.
- `server/booking.ts`: tRPC booking queries/mutations, server-side date/teacher/room validation, and conflict handling.
- `server/_core/site-password.ts` and `server/_core/trpc.ts`: signed shared-site-session verification for booking APIs.
- `server/routers.ts`: register the booking router.
- `drizzle/schema.ts`, `drizzle/0003_add_bookings.sql`, and `drizzle/meta/`: additive MySQL schema and migration metadata.
- `shared/timetable.ts`: canonical period/week/day types reused by the booking UI and API.
- `shared/school-week.ts`: date-only Monday-based A/B calculation with school-confirmed resets and skipped-week validation.
- `server/*test.ts` and `shared/*test.ts`: isolated tests for access, validation, parity, and conflicts.

## Design decisions

Reuse the deployed dashboard's approved visual system; do not redesign existing panels or alter the right-hand availability/schedule sizing.

- **Design movement:** editorial school operations tool with a calm, high-contrast utility surface.
- **Core principles:** fast scanning, clear availability, accessible form controls, and trustworthy conflict prevention.
- **Color philosophy:** warm paper-like neutrals carry the interface; green communicates available/bookable, red indicates a confirmed conflict, and amber marks explanatory limitations.
- **Layout paradigm:** a compact booking form alongside a focused list of existing reservations, responsive to a single column on small screens.
- **Signature elements:** existing Roomfinder mark, pill-style Week A/B label, and the current dashboard's teal booking-status accents.
- **Interaction philosophy:** derive the recurring week automatically from the chosen date; never ask teachers to guess A/B; make already-booked rooms unavailable and still enforce the database constraint.
- **Animation:** use only existing lightweight loading indicators; no decorative motion.
- **Typography system:** preserve the export's Plus Jakarta Sans/Inter stack, scale, spacing, and responsive breakpoints.
- **Brand essence:** a dependable school staff tool for finding and booking the right room; clear, practical, trustworthy.
- **Brand voice:** concise operational labels such as “Book a room” and “Available for this recurring slot”; clearly disclose that a reservation repeats each matching A/B week.
- **Wordmark and mark:** preserve the existing Roomfinder mark and project logo URL.
- **Signature brand color:** preserve the existing teal/green dashboard palette.
