import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  LockKeyhole,
  LogOut,
  LoaderCircle,
  ShieldCheck,
  UploadCloud,
} from "lucide-react";
import * as XLSX from "xlsx";

const ADMIN_HEADER = { "X-Requested-With": "RoomfinderAdmin" };
const PERIOD_IDS = ["mentor", "lesson1", "lesson2", "lesson3", "lesson4", "lesson5", "lesson6", "lesson7"] as const;
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] as const;
const WEEKS = ["A", "B"] as const;
type PeriodId = (typeof PERIOD_IDS)[number];
type ApiMessage = { message?: string; roomsProcessed?: number };
type ScheduleRow = {
  week: (typeof WEEKS)[number];
  day: (typeof DAYS)[number];
  period: PeriodId;
  occupant: string | null;
  occupantDisplay: string | null;
  staffCodes: string[];
  teachers?: string[];
};
type UploadRoom = { room: string; page: number; schedule: ScheduleRow[] };

async function readResponse(response: Response): Promise<ApiMessage> {
  try {
    return await response.json() as ApiMessage;
  } catch {
    return {};
  }
}

function normalizeHeader(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function textValue(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function periodId(value: unknown): PeriodId {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/\s+/g, "");
  if (normalized === "mentorgroup" || normalized === "mentor") return "mentor";
  const match = normalized.match(/^lesson([1-7])$/) ?? normalized.match(/^l([1-7])$/);
  if (match) return `lesson${match[1]}` as PeriodId;
  if (PERIOD_IDS.includes(normalized as PeriodId)) return normalized as PeriodId;
  throw new Error(`Invalid period “${String(value)}”. Use Mentor Group or Lesson 1–7.`);
}

function valueFrom(row: Record<string, unknown>, aliases: string[]): unknown {
  for (const alias of aliases) {
    const key = Object.keys(row).find(candidate => normalizeHeader(candidate) === alias);
    if (key) return row[key];
  }
  return undefined;
}

async function parseWorkbook(file: File): Promise<{ rooms: UploadRoom[] }> {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
  const sheetName = workbook.SheetNames.find(name => normalizeHeader(name) === "schedule") ?? workbook.SheetNames[0];
  if (!sheetName) throw new Error("The workbook does not contain a schedule sheet.");
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], { defval: null, raw: false });
  if (!rows.length) throw new Error("The schedule sheet is empty.");

  const roomMap = new Map<string, UploadRoom>();
  for (const row of rows) {
    const room = textValue(valueFrom(row, ["room", "roomnumber"]))?.toUpperCase();
    const week = textValue(valueFrom(row, ["week"]))?.toUpperCase();
    const day = textValue(valueFrom(row, ["day"])) as (typeof DAYS)[number] | null;
    if (!room || !week || !day) throw new Error("Every schedule row must include Room, Week, and Day.");
    if (!WEEKS.includes(week as (typeof WEEKS)[number])) throw new Error(`Invalid week “${week}”.`);
    if (!DAYS.includes(day)) throw new Error(`Invalid day “${day}”.`);
    const period = periodId(valueFrom(row, ["period", "periodid"]));
    const occupant = textValue(valueFrom(row, ["occupant", "rawoccupant", "sourceoccupant"]));
    const occupantDisplay = textValue(valueFrom(row, ["occupantdisplay", "subject", "display"]));
    const staffCodes = (textValue(valueFrom(row, ["staffcodes", "teachercodes"])) ?? "")
      .split(",").map(code => code.trim()).filter(Boolean);
    const pageValue = Number(valueFrom(row, ["sourcepage", "page"]) ?? 1);
    const current = roomMap.get(room) ?? { room, page: Number.isFinite(pageValue) && pageValue > 0 ? pageValue : 1, schedule: [] };
    current.schedule.push({ week: week as (typeof WEEKS)[number], day, period, occupant, occupantDisplay: occupantDisplay ?? occupant, staffCodes });
    roomMap.set(room, current);
  }

  const rooms = [...roomMap.values()];
  const seenRooms = new Set<string>();
  for (const room of rooms) {
    if (seenRooms.has(room.room)) throw new Error(`Duplicate room “${room.room}”.`);
    seenRooms.add(room.room);
    if (room.schedule.length !== 80) throw new Error(`${room.room} has ${room.schedule.length} schedule rows; every room must have exactly 80.`);
    const slots = new Set(room.schedule.map(slot => `${slot.week}|${slot.day}|${slot.period}`));
    if (slots.size !== 80) throw new Error(`${room.room} contains duplicate schedule slots.`);
  }
  if (!rooms.length) throw new Error("No rooms were found in the schedule sheet.");
  return { rooms };
}

function periodLabel(period: PeriodId): string {
  return period === "mentor" ? "Mentor Group" : `Lesson ${period.replace("lesson", "")}`;
}

export default function AdminPage() {
  const [checkingSession, setCheckingSession] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/admin/session", { credentials: "include", cache: "no-store" })
      .then(response => response.json() as Promise<{ authenticated: boolean }>)
      .then(result => { if (active) setAuthenticated(result.authenticated === true); })
      .catch(() => { if (active) setError("Could not check the admin session. Refresh the page to try again."); })
      .finally(() => { if (active) setCheckingSession(false); });
    return () => { active = false; };
  }, []);

  const login = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true); setError(""); setSuccess("");
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST", credentials: "include", headers: { ...ADMIN_HEADER, "Content-Type": "application/json" }, body: JSON.stringify({ password }),
      });
      const result = await readResponse(response);
      if (!response.ok) throw new Error(result.message || "Admin sign-in failed.");
      setAuthenticated(true); setPassword("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Admin sign-in failed.");
    } finally { setBusy(false); }
  };

  const downloadSchedule = async () => {
    setBusy(true); setError(""); setSuccess("");
    try {
      const response = await fetch("/api/admin/timetable/export", { credentials: "include", headers: ADMIN_HEADER, cache: "no-store" });
      const payload = await response.json() as { rooms?: Array<{ room: string; page: number; schedule: Array<ScheduleRow> }>; message?: string };
      if (!response.ok || !payload.rooms) throw new Error(payload.message || "The current timetable could not be exported.");
      const rows = payload.rooms.flatMap(room => room.schedule.map(slot => ({
        Room: room.room,
        "Source Page": room.page,
        Week: slot.week,
        Day: slot.day,
        Period: slot.period,
        "Period Label": periodLabel(slot.period),
        Occupant: slot.occupant ?? "",
        "Occupant Display": slot.occupantDisplay ?? "",
        "Teacher Codes": slot.staffCodes.join(", "),
        Teachers: slot.teachers?.join(", ") ?? "",
      })));
      const workbook = XLSX.utils.book_new();
      const sheet = XLSX.utils.json_to_sheet(rows);
      sheet["!cols"] = [{ wch: 12 }, { wch: 12 }, { wch: 8 }, { wch: 14 }, { wch: 12 }, { wch: 18 }, { wch: 42 }, { wch: 42 }, { wch: 18 }, { wch: 30 }];
      XLSX.utils.book_append_sheet(workbook, sheet, "Schedule");
      XLSX.writeFile(workbook, `spaceradar-current-schedule-${new Date().toISOString().slice(0, 10)}.xlsx`);
      const csvUrl = URL.createObjectURL(new Blob([XLSX.utils.sheet_to_csv(sheet)], { type: "text/csv;charset=utf-8" }));
      const csvLink = document.createElement("a");
      csvLink.href = csvUrl;
      csvLink.download = `spaceradar-current-schedule-${new Date().toISOString().slice(0, 10)}.csv`;
      csvLink.click();
      URL.revokeObjectURL(csvUrl);
      setSuccess(`Current schedule downloaded. ${payload.rooms.length} rooms included.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The current timetable could not be exported.");
    } finally { setBusy(false); }
  };

  const uploadTimetable = async () => {
    if (!file) { setError("Choose an updated schedule Excel file before uploading."); return; }
    if (!/\.(xlsx?|csv)$/i.test(file.name)) { setError("Please choose an .xlsx, .xls, or .csv file. The current timetable has not been changed."); return; }
    setBusy(true); setError(""); setSuccess("");
    try {
      const payload = await parseWorkbook(file);
      const response = await fetch("/api/admin/timetable/excel", {
        method: "POST", credentials: "include", headers: { ...ADMIN_HEADER, "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      const result = await readResponse(response);
      if (!response.ok) throw new Error(result.message || "The timetable could not be updated.");
      setSuccess(result.message || `Database updated successfully! ${result.roomsProcessed ?? 0} rooms processed.`);
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The timetable could not be updated. The existing timetable was not changed.");
    } finally { setBusy(false); }
  };

  const logout = async () => {
    setBusy(true); setError(""); setSuccess("");
    try { await fetch("/api/admin/logout", { method: "POST", credentials: "include", headers: ADMIN_HEADER }); }
    finally { setAuthenticated(false); setFile(null); setBusy(false); }
  };

  return (
    <div className="app-shell admin-shell">
      <header className="topbar"><div className="topbar-inner">
        <a className="brand" href="/" aria-label="SpaceRadar home"><span className="brand-mark"><ShieldCheck size={20} strokeWidth={2.1} /></span><span className="brand-copy"><strong>SPACERADAR</strong><span>ADMINISTRATION</span></span></a>
        <a className="admin-back-link" href="/"><ArrowLeft size={15} /> Staff room search</a>
      </div></header>
      <main className="admin-main">
        <div className="admin-heading"><div className="admin-eyebrow"><LockKeyhole size={14} /> AUTHORIZED STAFF ONLY</div><h1>Schedule administration</h1><p>Export the live schedule or replace it with a validated Excel workbook.</p></div>
        {checkingSession ? <div className="admin-card admin-loading" role="status"><LoaderCircle className="spin" size={21} /> Checking admin access…</div> : !authenticated ? (
          <section className="admin-card admin-login-card" aria-labelledby="admin-login-title"><div className="admin-card-icon"><LockKeyhole size={21} /></div><h2 id="admin-login-title">Admin sign-in</h2><p>Enter the administrator password to manage the timetable.</p><form className="admin-login-form" onSubmit={login}><label htmlFor="admin-password">Password</label><input id="admin-password" type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" required maxLength={256} autoFocus /><button className="admin-primary-button" type="submit" disabled={busy || !password}>{busy ? <LoaderCircle className="spin" size={17} /> : <LockKeyhole size={16} />} Sign in</button></form></section>
        ) : (
          <section className="admin-card admin-upload-card" aria-labelledby="upload-title">
            <div className="admin-upload-heading"><div><div className="admin-card-icon"><FileSpreadsheet size={21} /></div><h2 id="upload-title">Excel schedule tools</h2><p>Workbook parsing happens locally in your browser with no external AI processing.</p></div><button className="admin-logout-button" type="button" onClick={logout} disabled={busy}><LogOut size={15} /> Sign out</button></div>
            <div className="admin-replacement-note"><strong>Safe schedule replacement</strong><span>Download the current database as a Schedule workbook, edit it without changing the column names, then upload it here. Every room must contain exactly 80 unique Week/Day/Period rows. Invalid workbooks leave the existing timetable unchanged.</span></div>
            <div className="admin-tool-grid"><button className="admin-secondary-button" type="button" onClick={downloadSchedule} disabled={busy}><Download size={17} /> Download Current Schedule (Excel / CSV)</button><label className={`admin-dropzone${file ? " admin-dropzone-selected" : ""}`} htmlFor="timetable-excel"><span className="admin-upload-icon"><UploadCloud size={24} /></span><strong>{file ? file.name : "Choose an updated schedule Excel / CSV file"}</strong><span>{file ? `${(file.size / (1024 * 1024)).toFixed(2)} MB · Ready to parse locally` : "XLSX, XLS, or CSV files · maximum 20 MB"}</span><input ref={fileInput} id="timetable-excel" type="file" accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" disabled={busy} onChange={event => { setFile(event.target.files?.[0] ?? null); setError(""); setSuccess(""); }} /></label></div>
            <button className="admin-primary-button admin-upload-button" type="button" disabled={busy || !file} onClick={uploadTimetable}>{busy ? <LoaderCircle className="spin" size={17} /> : <UploadCloud size={17} />}{busy ? "Parsing and updating timetable…" : "Upload Updated Schedule (Excel / CSV)"}</button>
            {busy ? <p className="admin-progress" role="status"><LoaderCircle className="spin" size={15} /> Validating the workbook and saving the replacement schedule…</p> : null}
          </section>
        )}
        {error ? <div className="admin-message admin-error" role="alert"><AlertCircle size={17} /><span>{error}</span></div> : null}
        {success ? <div className="admin-message admin-success" role="status"><CheckCircle2 size={18} /><span>{success}</span></div> : null}
      </main>
      <footer className="footer"><div className="footer-inner"><span>SPACERADAR <span className="footer-divider">/</span> ADMIN</span><span>Live schedule tools · Browser-parsed Excel</span></div></footer>
    </div>
  );
}
