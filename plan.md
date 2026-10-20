# Roomfinder continuation plan

## Scope

Continue the supplied Roomfinder emergency export as an imported Webdev web project. Preserve the existing React / Express / tRPC / Drizzle implementation, visual language, timetable data, staff-resolution rules, tests, and secure admin workflow. Do not scaffold a replacement application or infer unresolved teacher identities.

## Implementation approach

1. Copy the supplied source tree into this fresh flexible Webdev project, excluding the archived project identity (`.manus-starter-init.json`), Git metadata, dependencies, and generated build output.
2. Preserve the existing frontend routes (`/` and `/admin`), shared timetable constants, server routers, Drizzle schema/migrations, PDF parser, seed data, and authoritative mapping files under `server/data/` plus `teachers_mapping.json`.
3. Keep teacher-resolution precedence exactly as documented: exact room/week/day/period/full-occupant overrides, active contextual exclusions and mentor rules, grade-and-subject workbook rules, then complete-roster fallback. Leave unresolved duplicate or multi-name Lab cases visible; retain the two explicitly confirmed two-staff exceptions.
4. Keep database-backed room availability and master schedules, the listed excluded rooms, Lab labels, source-cell suppressions, secure PDF upload replacement, and transaction/error behavior intact.
5. Register host-managed diagnostics, restore the pinned dependencies, run type checking, tests, and production build, then start the existing development command on the configured port 3000 and verify `/api/health` and `/manus-routes.json`.
6. Save the imported application as a checkpoint only after checks pass. Do not publish unless explicitly requested.

## Project structure

- `client/`: React application, pages, reusable UI, styles, and route entrypoints.
- `server/`: Express entrypoint, tRPC routers, timetable queries, admin PDF replacement route, auth helpers, parser support, and staff resolution.
- `server/data/`: checked-in timetable export, teacher roster, workbook subject rules, exact manual overrides, and source-cell suppressions.
- `drizzle/`: MySQL schema, relations, and checked-in migrations for classrooms and timetable entries.
- `scripts/`: deterministic timetable parsing, seeding, attribution backfill, and source-cell cleanup utilities.
- `shared/`: Week/Day/Period types, room exclusions, Lab labels, and shared constants.
- `public/`: static route manifest and project mark.

## Design decisions

The export already contains an approved staff-tool visual system, so no new style exploration is needed.

- **Design movement:** editorial school operations tool with a calm, high-contrast utility surface.
- **Core principles:** fast scanning, clear Free/Occupied status, mobile-first controls, and trustworthy ambiguity handling.
- **Color philosophy:** warm paper-like neutrals carry the interface; green communicates confirmed availability; red communicates occupancy; amber/neutral states communicate incomplete data without implying certainty.
- **Layout paradigm:** a compact editorial header followed by focused task panels and progressive disclosure from room search to full master schedule.
- **Signature elements:** the Roomfinder mark, pill-based status indicators, and Week A/B ribbon schedule blocks.
- **Interaction philosophy:** defaults make the common vacancy lookup immediate; room details open from result cards; unresolved names remain explicitly labeled rather than silently normalized.
- **Animation:** use only existing lightweight loading indicators and smooth result navigation; no decorative motion that slows staff lookup.
- **Typography system:** preserve the export’s existing font stack, scale, spacing, and responsive breakpoints.
- **Brand essence:** a dependable school staff tool for finding the right room quickly; clear, practical, trustworthy.
- **Brand voice:** concise operational labels such as “Find free rooms” and “Room master schedule”; avoid marketing copy.
- **Wordmark and mark:** preserve the supplied Roomfinder mark and existing `app.config.ts` logo URL.
- **Signature brand color:** preserve the existing export palette rather than introducing a new brand color.
