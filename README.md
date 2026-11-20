# Classroom Vacancy & Occupancy Search

React / Express / tRPC / Drizzle starter, adapted from the Sandbox web-db-user template.

- `pnpm dev`: development server; honors `PORT` (default 3000).
- `pnpm build` / `pnpm start`: build and serve `dist/index.js` and `dist/public/`.
- `pnpm db:migrate`: apply checked-in PostgreSQL migrations. `pnpm db:push`: generate and apply new schema changes.
- `pnpm db:import-timetable -- <path-to-xlsx-or-csv>`: validate and transactionally import a complete `Schedule` sheet into an empty database.
- `pnpm check` / `pnpm test`: types and application tests.

Neon writes local branch variables to `.env.local`, which is ignored by Git. The app uses pooled `DATABASE_URL` for normal traffic; Drizzle migrations and bulk imports prefer `DATABASE_URL_UNPOOLED` when available. Run migrations before starting the app. The importer refuses to overwrite existing timetable rows.

Start with the Webdev skill's default-template guide. Platform login, storage, payments and service contracts live in its shared references; read the relevant capability before extending its helper.

`server/_core/publicConfig.ts` exposes only named public runtime values. Private keys stay server-side. The platform serves managed `/manus-storage/` assets; the application does not register a second proxy.

Platform configuration is readable and editable through `webdev.config`. Default settings are initial values, not enforced constraints. The agent may modify the files, commands and configuration or follow the flexible guide for another stack.
