# TODO

- [x] **Restore the existing Roomfinder application in the fresh Webdev project.** Import the supplied React / Express / tRPC / Drizzle source, existing design, timetable export, server/data rules, scripts, migrations, tests, and admin workflow without rebuilding the product or copying the old project identity.
- [x] **Apply the authoritative teacher mapping rules during continuation.** Preserve exact manual room/week/day/period/full-occupant overrides first, then active contextual rules, grade-and-subject workbook rules, and roster fallback; do not guess unresolved duplicate initials or unconfirmed Lab conflicts, and retain the explicitly confirmed two-staff Lab exceptions.

- [x] **Import the complete PDF timetable into the application database.** Extract, parse, and process all timetable data from the attached PDF file to populate the application database. Support two alternating weeks (Week A and Week B), Monday through Friday, with each day starting with a Mentor Group session followed by exactly 7 lessons (Lesson 1 to Lesson 7). Preserve all classroom occupancy information represented in the source timetable.
- [x] **Find free rooms for a selected timetable slot.** Staff can select a Week (A/B), a Day (Mon–Fri), and a Period (Mentor Group, or Lesson 1–7) from dropdown menus. The system must instantly list all classrooms that are completely “Free” during that specific time slot.
- [x] **Search a room and view its complete occupant schedule.** Staff can search or select a room number to view its full master schedule for both Week A and Week B. It must show exactly who (teacher, class, or mentor group) is in the room for each slot, or display “Free” if vacant.
- [x] **Provide a clean, fast, highly mobile-responsive staff interface.** Teachers must be able to check room availability quickly on their phones. Use distinct visual indicators, such as Green for “Free” and Red for “Occupied” statuses.
- [x] **Show identifiable staff names for occupied rooms.** Use the uploaded teacher-abbreviation workbook to identify the staff member in each room, displaying full names (for example, show “Joyce Ho” instead of “JH”) alongside the timetable class/subject details. Do not guess when an abbreviation has multiple possible staff matches.
- [x] **Exclude the requested rooms from room searches.** Remove “GLC”, “Auditorium”, “LT1”, “LT2”, “GLC glassroom”, “A603”, and “A708” from room search, free-room results, and room master schedule choices.
- [x] **Protect the admin page and timetable upload.** Create a new password-protected route at `/admin`. Set an admin login password securely. Build a clean interface with a secure file upload zone labeled “Upload New Timetable PDF”.
- [x] **Replace the timetable database from an uploaded PDF.** Connect the PDF parsing code used for the initial launch to the upload button. When an admin uploads a new PDF, the system must automatically wipe the old database records and re-parse the new PDF to completely update the room schedule. It must handle different teacher names and new room numbers as long as the PDF table layout remains consistent.
- [x] **Show upload progress, exact success notice, and parse errors.** Show a loading spinner during parsing. Once updated, display exactly: “Database updated successfully! [X] rooms processed.” Catch invalid file types and corrupted PDFs without leaving the timetable partially replaced.
- [x] **Apply the additional staff corrections supplied for initials and subjects.** YA is Anantha because Yvonne has left; Sean is DT; Sarah Morrison has no lesson; Mason Stewart is Science and Physics; Shahzeb is coding; Leanne Kingston is Art; Kelsey Lowe is History; and Paul Gillespie is English and Integrated English. Apply these facts with the earlier subject/role corrections when the timetable provides matching context.
- [x] **Preserve unresolved staff ambiguity.** Do not assign a unique person when the PDF’s subject or period does not match a supplied correction; keep the remaining candidate names or raw timetable entry visible rather than guessing.
- [x] **Use the new Lessons workbook to improve staff matching.** Use the teacher, class, subject, and cycle information in `first.xlsx` to associate teacher abbreviations with a named staff member when the timetable’s class/subject matches the workbook; retain ambiguity if the match is not unique. The workbook has no day/period assignment, so the PDF remains the source for room/time occupancy.
- [x] **Remove the listed rooms and five erroneous schedule cells.** Exclude “GLC”, “Auditorium”, “LT1”, “LT2”, and “GLC glassroom”. Clear the cell at B409—Week A Thursday Lesson 4; B513—Week A Wednesday Lesson 4 and Week B Tuesday Lesson 4; and B306—Week A Friday Lesson 4 and Week B Thursday Lesson 4, whose source text refers to “A40 7-A4 08 + GLC 4/F”. These cells should display as Free without erasing unrelated room records.
- [x] **Apply the supplied named staff corrections.** Show Sarah Emberger for the six listed A203 Personal Study cells; Billy Grindley (“Billy G”) for the specified Year 12 Geography cells; Woo Sik Byun for the specified Year 13 Economics cells; Ho Ying Amata Lo (the workbook’s full name for “Amato Lo”) for the Year 12 Art entries; and Deeksha Gokool Bhakarreea for the Year 13 Art entries.
- [x] **Apply the latest room-specific staff corrections.** Resolve B607 Week A Tuesday Lesson 3, “11I E2 G P”, as Integrated English with Paul Gillespie. Show Paul Stanley for occupied entries in B408. Show Peter Stapleton for occupied entries in B513, except B513 Week A Thursday Lesson 1 and Week B Tuesday Lesson 3, which are Paul Stanley. Preserve occupied/free status and unrelated cells.
- [x] **Apply the latest teacher and room corrections.** Exclude rooms A603 and A708 from search/results/master schedules. Do not show Sze Yin Hung (abbreviation YS; listed in the workbook with no class teaching) as a lesson teacher. Resolve ET to Shahzeb.
- [x] **Label the specified twelve rooms as Labs.** Show a Lab label for B301, B304, B303, B305, B401, B404, B403, B501, B601, B602, B604, and B605 in the staff-facing room search and master schedules.
- [x] **Do not attribute Steve Hackman to the listed Labs.** Exclude his name from staff attribution in all twelve listed rooms while preserving the original room occupancy and timetable details.
- [ ] **Show exactly one teacher for each occupied Lab slot.** Where timetable cells contain multiple teacher codes or multiple resolved staff names, do not choose a teacher by guess; keep the conflict visible and obtain the user's correction before applying a single-name assignment.
- [x] **Apply the user-confirmed Lab text patterns.** Map the five `12 ES P ... SS M L1` cells to Patrick Mcgovern, the five `13 ES C ... SS M L3` cells to Caroline Jane Morgan, and the two `12 SV ES C ... SS L3 C` cells to Stephanie Visser and Curtis Chung.
- [ ] **Identify the remaining Lab slots without a teacher name and resolve any unconfirmed multi-name cells.** Keep the source room occupied, do not restore Steve Hackman in the listed Labs, and apply only the teacher mappings confirmed by the user. The two specified SV/CC cells are an explicit two-staff correction from the user.
- [x] **Apply the Craig and Biology text-pattern corrections.** Map the six `13 ES C SS B L2 ... 13 ES C SH B L2` cells to Craig Billington, and map the six `13 BIO C HL M 4 ... 13 BIO C SL M 4` cells to Caroline Jane Morgan.
- [x] **Apply the latest four name corrections to every exact matching timetable cell.** Map the five `13 ES B SS G L1 ... 13 ES B SH G L1` cells to Billy Grindley, three `12 PH M YH S L3 ... 12 PH M YS S L3` cells to Mason Stewart, five `12 PH S YH KI L2 ... 12 PH S YS KI L2` cells to Samuel Kim, and six `12 S CH K MH E L5 ... 12 S CH K MS E L5` cells to Simon Kelleher.

## Current feature request
- [x] **Provide direct room selection.** Keep the existing manual room-number text search and add a scrollable room-number dropdown for direct selection in the room schedule view; selecting either input must load the same complete Week A and Week B room schedule.
- [x] **Add teacher location search.** Allow staff to search a teacher by full name, such as “Joyce Ho”, and show every matching room and selected timetable slot with the teacher name, room number, lesson label, day, and week; use the existing authoritative teacher-resolution rules and never guess unresolved duplicate initials.
- [x] **Add current schedule Excel download in Admin.** Replace the old PDF admin workflow with a “Download Current Schedule (Excel)” action that generates a `.xlsx` workbook from live database records, including teacher schedule data, room numbers, alternating week, weekday, period, subject/occupant display, raw occupant text, staff codes, and source page.
- [x] **Add deterministic Excel upload replacement in Admin.** Add an “Upload Updated Schedule (Excel)” file input. Parse the workbook locally in browser JavaScript with no external AI processing, validate the normalized schedule shape, send the parsed rows to the authenticated server, and transactionally replace the current classrooms and timetable entries; invalid or incomplete workbooks must leave the existing database unchanged and show a clear error.

## Permanent publication of supplied website

- [x] Import the existing website files without redesigning, rewriting, or modifying application code; preserve the supplied UI, scrolling behavior and all existing teacher data, including Bian Tao, Brian and Sam Lingwood.
- [x] Install required dependencies and run the existing build process as necessary for deployment.
- [ ] Deploy to a permanent publicly accessible website using minimal work.


## Vercel deployment setup
- [ ] Add a root `vercel.json` and recognized Express entrypoint so Vercel routes incoming requests to the Express app as a serverless function.
- [ ] Identify the exact runtime environment-variable names required by this repository and explain which values the owner must add in Vercel Settings without exposing secret values.
- [ ] Provide the exact Vercel Build Command and Output Directory settings for this Vite/Express project.


## Vercel serverless build repair
- [x] Resolve the reported error “no Express entrypoint in dist/public” by routing through the root Express serverless handler; keep the Vite frontend output in `dist/public`, but do not make that directory the Express entrypoint directory.
- [x] Ensure `package.json`’s build command compiles the frontend and backend for Vercel serverless use, push the configuration to GitHub `main`, and do not run heavy local build tests.


## Vercel production function response
- [ ] Ensure the root Express function serves `/api/health` and `/` without `FUNCTION_INVOCATION_FAILED` in production, while preserving the existing API and Vite-built frontend.
- [ ] Do not run heavy local build tests; validate through the deployment triggered by the GitHub `main` push.


## Vercel Node ESM import resolution
- [x] Ensure every relative import in the deployed server module graph uses an explicit `.js` or `.ts` extension so Node ESM does not throw `ERR_MODULE_NOT_FOUND` (e.g. `/var/task/server/_core/app`); or use an equivalent compiler configuration.
- [x] Commit and push the fix to GitHub `main` without running a heavy local build.


## Vercel root server.js refresh
- [x] Create or update the root `server.js` with an explicit `.js` extension on the import from `./server/_core/app.js`.
- [x] Add the marker `// Vercel Deploy Fix v2` so the source change is distinct from the prior pushed commit.
- [x] Commit and push the update to GitHub `main` without running a heavy local build; preserve existing commit history.
