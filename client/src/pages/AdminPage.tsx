import { useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  LockKeyhole,
  LoaderCircle,
  ShieldCheck,
  UploadCloud,
} from "lucide-react";
import * as XLSX from "xlsx";
import { startLogin } from "@/const";
import { trpc } from "@/lib/trpc";
import { hasAdminRole } from "@/lib/admin-access";
import { COOKIE_NAME } from "@shared/const";

const ADMIN_HEADER = { "X-Requested-With": "RoomfinderAdmin" };
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] as const;
const WEEKS = ["A", "B"] as const;
type PeriodId = "mentor" | `lesson${1 | 2 | 3 | 4 | 5 | 6 | 7}`;
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

function adminRequestHeaders(contentType?: string): Record<string, string> {
  const headers: Record<string, string> = { ...ADMIN_HEADER };
  if (contentType) headers["Content-Type"] = contentType;
  try {
    const raw = sessionStorage.getItem("manus-cookie");
    const prefix = `${COOKIE_NAME}=`;
    const pair = raw?.split(";").find(value => value.trim().startsWith(prefix));
    const token = pair?.trim().slice(prefix.length);
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch {
    // Regular same-origin cookies continue to authenticate this request.
  }
  return headers;
}

async function readResponse(response: Response): Promise<ApiMessage> {
  try {
    return await response.json() as ApiMessage;
  } catch {
    return {};
  }
}

function periodLabel(period: PeriodId): string {
  return period === "mentor" ? "Mentor Group" : `Lesson ${period.replace("lesson", "")}`;
}

export default function AdminPage() {
  const authQuery = trpc.auth.me.useQuery(undefined, { retry: false, staleTime: 30_000, refetchOnWindowFocus: true });
  const isAdmin = hasAdminRole(authQuery.data?.role);
  const logoutMutation = trpc.auth.logout.useMutation();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const downloadSchedule = async () => {
    setBusy(true); setError(""); setSuccess("");
    try {
      const response = await fetch("/api/admin/timetable/export", { credentials: "include", headers: adminRequestHeaders(), cache: "no-store" });
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
      const fileName = `spaceradar-current-schedule-${new Date().toISOString().slice(0, 10)}`;
      XLSX.writeFile(workbook, `${fileName}.xlsx`);
      const csvUrl = URL.createObjectURL(new Blob([XLSX.utils.sheet_to_csv(sheet)], { type: "text/csv;charset=utf-8" }));
      const csvLink = document.createElement("a");
      csvLink.href = csvUrl;
      csvLink.download = `${fileName}.csv`;
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
    if (file.size > 20 * 1024 * 1024) { setError("The Excel schedule is larger than the 20 MB upload limit. The current timetable has not been changed."); return; }
    setBusy(true); setError(""); setSuccess("");
    try {
      const response = await fetch("/api/admin/timetable/excel", {
        method: "POST",
        credentials: "include",
        headers: adminRequestHeaders(file.type || "application/octet-stream"),
        body: file,
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

  const checkingSession = authQuery.isLoading;
  const beginSecureSignIn = () => {
    setError("");
    try {
      startLogin();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Secure sign-in could not be opened.");
    }
  };
  const switchToAuthorizedAccount = async () => {
    setError("");
    try {
      await logoutMutation.mutateAsync();
      startLogin();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not sign out before switching accounts.");
    }
  };

  return (
    <div className="app-shell admin-shell">
      <header className="topbar"><div className="topbar-inner">
        <a className="brand" href="/" aria-label="SpaceRadar home"><span className="brand-mark"><ShieldCheck size={20} strokeWidth={2.1} /></span><span className="brand-copy"><strong>SPACERADAR</strong><span>ADMINISTRATION</span></span></a>
        <a className="admin-back-link" href="/"><ArrowLeft size={15} /> Staff room search</a>
      </div></header>
      <main className="admin-main">
        <div className="admin-heading"><div className="admin-eyebrow"><LockKeyhole size={14} /> AUTHORIZED STAFF ONLY</div><h1>Schedule administration</h1><p>Export the live schedule or replace it with a validated Excel workbook.</p></div>
        {checkingSession ? <div className="admin-card admin-loading" role="status"><LoaderCircle className="spin" size={21} /> Checking Admin role…</div> : isAdmin ? (
          <section className="admin-card admin-upload-card" aria-labelledby="upload-title">
            <div className="admin-upload-heading"><div><div className="admin-card-icon"><FileSpreadsheet size={21} /></div><h2 id="upload-title">Excel schedule tools</h2><p>Only a verified Admin account can download or upload the shared schedule.</p></div></div>
            <div className="admin-replacement-note"><strong>Safe schedule replacement</strong><span>Download the current database as a Schedule workbook, edit it without changing the column names, then upload it here. The server parses the workbook and requires every room to contain exactly 80 unique Week/Day/Period rows. Invalid workbooks leave the existing timetable unchanged.</span></div>
            <div className="admin-tool-grid"><button className="admin-secondary-button" type="button" onClick={downloadSchedule} disabled={busy}><Download size={17} /> Download Current Schedule (Excel / CSV)</button><label className={`admin-dropzone${file ? " admin-dropzone-selected" : ""}`} htmlFor="timetable-excel"><span className="admin-upload-icon"><UploadCloud size={24} /></span><strong>{file ? file.name : "Choose an updated schedule Excel / CSV file"}</strong><span>{file ? `${(file.size / (1024 * 1024)).toFixed(2)} MB · Ready to upload` : "XLSX, XLS, or CSV files · maximum 20 MB"}</span><input ref={fileInput} id="timetable-excel" type="file" accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" disabled={busy} onChange={event => { setFile(event.target.files?.[0] ?? null); setError(""); setSuccess(""); }} /></label></div>
            <button className="admin-primary-button admin-upload-button" type="button" disabled={busy || !file} onClick={uploadTimetable}>{busy ? <LoaderCircle className="spin" size={17} /> : <UploadCloud size={17} />}{busy ? "Server parsing and updating timetable…" : "Upload Updated Schedule (Excel / CSV)"}</button>
            {busy ? <p className="admin-progress" role="status"><LoaderCircle className="spin" size={15} /> Validating the workbook and saving the replacement schedule…</p> : null}
          </section>
        ) : authQuery.isError ? (
          <section className="admin-card admin-login-card" role="alert" aria-labelledby="admin-access-title">
            <div className="admin-card-icon"><LockKeyhole size={21} /></div>
            <h2 id="admin-access-title">Could not verify Admin access</h2>
            <p>Your account could not be checked. Retry the secure role check before continuing.</p>
            <button className="admin-secondary-button" type="button" onClick={() => { void authQuery.refetch(); }}>Retry role check</button>
          </section>
        ) : !authQuery.data ? (
          <section className="admin-card admin-login-card" role="status" aria-labelledby="admin-login-title">
            <div className="admin-card-icon"><LockKeyhole size={21} /></div>
            <h2 id="admin-login-title">Admin sign-in</h2>
            <p>Continue with your authorized YCIS/Manus account. Schedule tools appear only after the server verifies its Admin role.</p>
            <button className="admin-primary-button" type="button" onClick={beginSecureSignIn}><ShieldCheck size={17} /> Continue to secure sign-in</button>
          </section>
        ) : (
          <section className="admin-card admin-login-card" role="status" aria-labelledby="admin-access-title">
            <div className="admin-card-icon"><LockKeyhole size={21} /></div>
            <h2 id="admin-access-title">Admin access required</h2>
            <p>This signed-in account does not have the Admin role. Ask an administrator to grant access, or switch to the authorized account.</p>
            <button className="admin-secondary-button" type="button" onClick={() => { void switchToAuthorizedAccount(); }} disabled={logoutMutation.isPending}>
              {logoutMutation.isPending ? <LoaderCircle className="spin" size={16} /> : <ArrowLeft size={15} />}
              {logoutMutation.isPending ? "Signing out…" : "Sign in with a different account"}
            </button>
            <a className="admin-secondary-button" href="/">Return to staff room search</a>
          </section>
        )}
        {error ? <div className="admin-message admin-error" role="alert"><AlertCircle size={17} /><span>{error}</span></div> : null}
        {success ? <div className="admin-message admin-success" role="status"><CheckCircle2 size={18} /><span>{success}</span></div> : null}
      </main>
      <footer className="footer"><div className="footer-inner"><span>SPACERADAR <span className="footer-divider">/</span> ADMIN</span><span>Live schedule tools · Server-validated Excel</span></div></footer>
    </div>
  );
}
