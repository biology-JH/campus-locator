import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  LockKeyhole,
  LoaderCircle,
  ShieldCheck,
  Trash2,
  UploadCloud,
} from "lucide-react";
import * as XLSX from "xlsx";
import { trpc } from "@/lib/trpc";
import { hasAdminRole } from "@/lib/admin-access";
import { COOKIE_NAME } from "@shared/const";

const ADMIN_HEADER = { "X-Requested-With": "RoomfinderAdmin" };
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] as const;
const WEEKS = ["A", "B"] as const;
type PeriodId = "mentor" | `lesson${1 | 2 | 3 | 4 | 5 | 6 | 7}`;
type ApiMessage = {
  message?: string;
  roomsProcessed?: number;
  bookings?: AdminBookingRow[];
  currentCount?: number;
  retainedCount?: number;
  cancelledCount?: number;
  requiresEmptyConfirmation?: boolean;
};
type AdminBookingRow = {
  id: number;
  date: string;
  period: string;
  week: (typeof WEEKS)[number];
  day: (typeof DAYS)[number];
  room: string;
  teacher: string;
  createdAt: string;
};
type BookingSyncPreview = {
  currentCount: number;
  retainedCount: number;
  cancelledCount: number;
  requiresEmptyConfirmation: boolean;
};
type ScheduleRow = {
  week: (typeof WEEKS)[number];
  day: (typeof DAYS)[number];
  period: PeriodId;
  occupant: string | null;
  occupantDisplay: string | null;
  staffCodes: string[];
  teachers?: string[];
};

function adminRequestHeaders(contentType?: string, additionalHeaders: Record<string, string> = {}): Record<string, string> {
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
  return { ...headers, ...additionalHeaders };
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
  const adminSessionQuery = trpc.auth.adminSessionStatus.useQuery(undefined, { retry: false, staleTime: 0, refetchOnWindowFocus: true });
  const isAdmin = hasAdminRole(authQuery.data?.role) || adminSessionQuery.data?.isAdmin === true;
  const hasPasswordSession = adminSessionQuery.data?.passwordSession === true;
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const bookingCsvInput = useRef<HTMLInputElement>(null);
  const [bookingRows, setBookingRows] = useState<AdminBookingRow[]>([]);
  const [bookingsLoading, setBookingsLoading] = useState(false);
  const [bookingActionBusy, setBookingActionBusy] = useState(false);
  const [removingBookingId, setRemovingBookingId] = useState<number | null>(null);
  const [bookingCsvFile, setBookingCsvFile] = useState<File | null>(null);
  const [bookingCsvDragging, setBookingCsvDragging] = useState(false);
  const [bookingSnapshotToken, setBookingSnapshotToken] = useState("");
  const [bookingSyncPreview, setBookingSyncPreview] = useState<BookingSyncPreview | null>(null);
  const [confirmCancelAll, setConfirmCancelAll] = useState(false);

  const refreshBookings = useCallback(async () => {
    setBookingsLoading(true);
    try {
      const response = await fetch("/api/admin/bookings", { credentials: "include", headers: adminRequestHeaders(), cache: "no-store" });
      const payload = await readResponse(response);
      if (!response.ok || !Array.isArray(payload.bookings)) throw new Error(payload.message || "Active bookings could not be loaded.");
      setBookingRows(payload.bookings);
    } finally {
      setBookingsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) {
      setBookingRows([]);
      return;
    }
    void refreshBookings().catch(caught => setError(caught instanceof Error ? caught.message : "Active bookings could not be loaded."));
  }, [isAdmin, refreshBookings]);

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

  const downloadMasterScheduleCsv = async () => {
    setBookingActionBusy(true); setError(""); setSuccess("");
    try {
      const response = await fetch("/api/admin/bookings/export", { credentials: "include", headers: adminRequestHeaders(), cache: "no-store" });
      if (!response.ok) {
        const payload = await readResponse(response);
        throw new Error(payload.message || "The Master Schedule CSV could not be downloaded.");
      }
      const snapshotToken = response.headers.get("x-booking-snapshot-token");
      if (!snapshotToken) throw new Error("The server did not return a signed booking snapshot. Refresh the page and retry.");
      const objectUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = "campus-locator-master-schedule.csv";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      setBookingSnapshotToken(snapshotToken);
      setBookingCsvFile(null);
      setBookingSyncPreview(null);
      setConfirmCancelAll(false);
      if (bookingCsvInput.current) bookingCsvInput.current.value = "";
      setSuccess("Master Schedule CSV downloaded. Its signed snapshot is ready for a removal-only cancellation sync in this Admin session.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The Master Schedule CSV could not be downloaded.");
    } finally {
      setBookingActionBusy(false);
    }
  };

  const chooseBookingCsv = (nextFile: File | null) => {
    setError(""); setSuccess(""); setBookingSyncPreview(null); setConfirmCancelAll(false);
    if (!nextFile) { setBookingCsvFile(null); return; }
    if (!/\.csv$/i.test(nextFile.name)) { setBookingCsvFile(null); setError("Choose the downloaded .csv Master Schedule file. No bookings were changed."); return; }
    if (nextFile.size === 0 || nextFile.size > 5 * 1024 * 1024) { setBookingCsvFile(null); setError("The booking CSV must be non-empty and no larger than 5 MB. No bookings were changed."); return; }
    setBookingCsvFile(nextFile);
  };

  const previewBookingCsv = async () => {
    if (!bookingCsvFile) { setError("Choose the edited Master Schedule CSV first."); return; }
    if (!bookingSnapshotToken) { setError("Download a fresh Master Schedule CSV in this Admin session before uploading it."); return; }
    setBookingActionBusy(true); setError(""); setSuccess("");
    try {
      const response = await fetch("/api/admin/bookings/csv/preview", {
        method: "POST",
        credentials: "include",
        headers: adminRequestHeaders("text/csv", { "X-Booking-Snapshot-Token": bookingSnapshotToken }),
        body: bookingCsvFile,
      });
      const payload = await readResponse(response);
      if (!response.ok) {
        if (response.status === 409) setBookingSnapshotToken("");
        throw new Error(payload.message || "The booking CSV could not be validated.");
      }
      setBookingSyncPreview({
        currentCount: payload.currentCount ?? 0,
        retainedCount: payload.retainedCount ?? 0,
        cancelledCount: payload.cancelledCount ?? 0,
        requiresEmptyConfirmation: payload.requiresEmptyConfirmation === true,
      });
      setSuccess("CSV validated. Review the cancellation count before applying the snapshot.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The booking CSV could not be validated.");
    } finally {
      setBookingActionBusy(false);
    }
  };

  const applyBookingCsv = async () => {
    if (!bookingCsvFile || !bookingSnapshotToken || !bookingSyncPreview) return;
    if (bookingSyncPreview.requiresEmptyConfirmation && !confirmCancelAll) return;
    setBookingActionBusy(true); setError(""); setSuccess("");
    try {
      const additionalHeaders: Record<string, string> = { "X-Booking-Snapshot-Token": bookingSnapshotToken };
      if (confirmCancelAll) additionalHeaders["X-Confirm-Empty-Snapshot"] = "true";
      const response = await fetch("/api/admin/bookings/csv/sync", {
        method: "POST",
        credentials: "include",
        headers: adminRequestHeaders("text/csv", additionalHeaders),
        body: bookingCsvFile,
      });
      const payload = await readResponse(response);
      if (!response.ok) {
        if (response.status === 409) setBookingSnapshotToken("");
        throw new Error(payload.message || "Booking cancellations could not be saved.");
      }
      setSuccess(payload.message || "Booking cancellation snapshot applied.");
      setBookingSnapshotToken("");
      setBookingCsvFile(null);
      setBookingSyncPreview(null);
      setConfirmCancelAll(false);
      if (bookingCsvInput.current) bookingCsvInput.current.value = "";
      void refreshBookings().catch(caught => setError(caught instanceof Error ? caught.message : "Bookings changed, but the refreshed list could not be loaded."));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Booking cancellations could not be saved.");
    } finally {
      setBookingActionBusy(false);
    }
  };

  const removeBookingRow = async (id: number) => {
    setBookingActionBusy(true); setRemovingBookingId(id); setError(""); setSuccess("");
    try {
      const response = await fetch(`/api/admin/bookings/${id}`, {
        method: "DELETE",
        credentials: "include",
        headers: adminRequestHeaders(),
      });
      const payload = await readResponse(response);
      if (!response.ok) throw new Error(payload.message || "The booking row could not be removed.");
      setBookingSnapshotToken("");
      setBookingCsvFile(null);
      setBookingSyncPreview(null);
      setConfirmCancelAll(false);
      if (bookingCsvInput.current) bookingCsvInput.current.value = "";
      setSuccess("Booking row removed from the active schedule.");
      void refreshBookings().catch(caught => setError(caught instanceof Error ? caught.message : "The booking was removed, but the refreshed list could not be loaded."));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The booking row could not be removed.");
    } finally {
      setBookingActionBusy(false);
      setRemovingBookingId(null);
    }
  };

  const checkingSession = authQuery.isLoading || adminSessionQuery.isLoading;
  const submitAdminPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true); setError(""); setSuccess("");
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const result = await readResponse(response);
      if (!response.ok) throw new Error(result.message || "Admin sign-in failed.");
      setPassword("");
      const session = await adminSessionQuery.refetch();
      await authQuery.refetch();
      if (!session.data?.isAdmin) throw new Error("The Admin session could not be verified. Please try again.");
      setSuccess("Admin access verified. Timetable and room-booking tools are now available.");
    } catch (caught) {
      setPassword("");
      setError(caught instanceof Error ? caught.message : "Admin sign-in failed.");
    } finally {
      setBusy(false);
    }
  };
  const endPasswordSession = async () => {
    setBusy(true); setError(""); setSuccess("");
    try {
      const response = await fetch("/api/admin/logout", { method: "POST", credentials: "include", headers: ADMIN_HEADER });
      if (!response.ok) throw new Error("The Admin session could not be ended.");
      await Promise.all([adminSessionQuery.refetch(), authQuery.refetch()]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The Admin session could not be ended.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app-shell admin-shell">
      <header className="topbar"><div className="topbar-inner">
        <a className="brand" href="/" aria-label="SpaceRadar home"><span className="brand-mark"><ShieldCheck size={20} strokeWidth={2.1} /></span><span className="brand-copy"><strong>SPACERADAR</strong><span>ADMINISTRATION</span></span></a>
        <a className="admin-back-link" href="/"><ArrowLeft size={15} /> Staff room search</a>
      </div></header>
      <main className="admin-main">
        <div className="admin-heading"><div className="admin-eyebrow"><LockKeyhole size={14} /> AUTHORIZED STAFF ONLY</div><h1>Schedule administration</h1><p>Sign in with your Admin password to access timetable and room-booking controls.</p></div>
        {checkingSession ? <div className="admin-card admin-loading" role="status"><LoaderCircle className="spin" size={21} /> Checking Admin role…</div> : isAdmin ? (
          <>
          <section className="admin-card admin-upload-card" aria-labelledby="upload-title">
            <div className="admin-upload-heading"><div><div className="admin-card-icon"><FileSpreadsheet size={21} /></div><h2 id="upload-title">Excel schedule tools</h2><p>Only a verified Admin account or signed Admin password session can download or upload the shared schedule.</p></div>{hasPasswordSession && !hasAdminRole(authQuery.data?.role) ? <button className="admin-session-button" type="button" onClick={endPasswordSession} disabled={busy || bookingActionBusy}>Lock Admin tools</button> : null}</div>
            <div className="admin-replacement-note"><strong>Safe schedule replacement</strong><span>Download the current database as a Schedule workbook, edit it without changing the column names, then upload it here. The server parses the workbook and requires every room to contain exactly 80 unique Week/Day/Period rows. Invalid workbooks leave the existing timetable unchanged.</span></div>
            <div className="admin-tool-grid"><button className="admin-secondary-button" type="button" onClick={downloadSchedule} disabled={busy}><Download size={17} /> Download Current Schedule (Excel / CSV)</button><label className={`admin-dropzone${file ? " admin-dropzone-selected" : ""}`} htmlFor="timetable-excel"><span className="admin-upload-icon"><UploadCloud size={24} /></span><strong>{file ? file.name : "Choose an updated schedule Excel / CSV file"}</strong><span>{file ? `${(file.size / (1024 * 1024)).toFixed(2)} MB · Ready to upload` : "XLSX, XLS, or CSV files · maximum 20 MB"}</span><input ref={fileInput} id="timetable-excel" type="file" accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" disabled={busy} onChange={event => { setFile(event.target.files?.[0] ?? null); setError(""); setSuccess(""); }} /></label></div>
            <button className="admin-primary-button admin-upload-button" type="button" disabled={busy || !file} onClick={uploadTimetable}>{busy ? <LoaderCircle className="spin" size={17} /> : <UploadCloud size={17} />}{busy ? "Server parsing and updating timetable…" : "Upload Updated Schedule (Excel / CSV)"}</button>
            {busy ? <p className="admin-progress" role="status"><LoaderCircle className="spin" size={15} /> Validating the workbook and saving the replacement schedule…</p> : null}
          </section>
          <section className="admin-card admin-bookings-card" aria-labelledby="bookings-title">
            <div className="admin-bookings-heading">
              <div>
                <div className="admin-card-icon"><FileSpreadsheet size={21} /></div>
                <h2 id="bookings-title">Active room bookings</h2>
                <p>Review recurring reservations and remove an individual booking row directly from the live database.</p>
              </div>
              <button className="admin-primary-button admin-master-csv-button" type="button" onClick={downloadMasterScheduleCsv} disabled={bookingActionBusy}>
                {bookingActionBusy ? <LoaderCircle className="spin" size={17} /> : <Download size={17} />}
                Download Master Schedule CSV
              </button>
            </div>
            <div className="admin-booking-table-region" role="region" aria-label="Active room bookings" tabIndex={0}>
              {bookingsLoading ? <div className="admin-loading"><LoaderCircle className="spin" size={18} /> Loading active bookings…</div> : bookingRows.length === 0 ? (
                <div className="admin-booking-empty">No active room bookings.</div>
              ) : (
                <table className="admin-booking-table">
                  <thead><tr><th>Date</th><th>Period</th><th>Week</th><th>Room</th><th>Teacher</th><th>Action</th></tr></thead>
                  <tbody>{bookingRows.map(row => (
                    <tr key={row.id}>
                      <td>{row.date}</td>
                      <td>{row.period}</td>
                      <td><span className="admin-booking-week">Week {row.week}</span></td>
                      <td><strong>{row.room}</strong></td>
                      <td>{row.teacher}</td>
                      <td><button className="admin-remove-row-button" type="button" disabled={bookingActionBusy} onClick={() => void removeBookingRow(row.id)}>
                        {removingBookingId === row.id ? <LoaderCircle className="spin" size={14} /> : <Trash2 size={14} />}
                        {removingBookingId === row.id ? "Removing…" : "Remove Row"}
                      </button></td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
            </div>
          </section>
          <section className="admin-card admin-bookings-card" aria-labelledby="booking-sync-title">
            <div className="admin-card-icon"><UploadCloud size={21} /></div>
            <h2 id="booking-sync-title">Booking cancellation sync</h2>
            <p>Download the Master Schedule CSV, remove canceled rows, then upload that same file in this session. CSV sync is removal-only: added/edited rows and stale snapshots are rejected.</p>
            <div className="admin-snapshot-status" role="status">
              <ShieldCheck size={15} />
              {bookingSnapshotToken ? "Fresh signed CSV snapshot ready" : "Download Master Schedule CSV to start"}
            </div>
            <label
              className={`admin-dropzone admin-booking-dropzone${bookingCsvFile ? " admin-dropzone-selected" : ""}${bookingCsvDragging ? " admin-dropzone-dragging" : ""}`}
              htmlFor="booking-csv"
              role="button"
              tabIndex={0}
              onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); bookingCsvInput.current?.click(); } }}
              onDragOver={event => { event.preventDefault(); setBookingCsvDragging(true); }}
              onDragLeave={() => setBookingCsvDragging(false)}
              onDrop={event => { event.preventDefault(); setBookingCsvDragging(false); chooseBookingCsv(event.dataTransfer.files[0] ?? null); }}
            >
              <span className="admin-upload-icon"><UploadCloud size={23} /></span>
              <strong>{bookingCsvFile ? bookingCsvFile.name : "Upload Updated Schedule"}</strong>
              <span>{bookingCsvFile ? `${(bookingCsvFile.size / 1024).toFixed(1)} KB · Ready to preview` : "Drop the edited .csv file here or click to browse · maximum 5 MB"}</span>
              <input ref={bookingCsvInput} id="booking-csv" type="file" accept=".csv,text/csv,application/vnd.ms-excel" disabled={bookingActionBusy} onChange={event => chooseBookingCsv(event.target.files?.[0] ?? null)} />
            </label>
            {bookingSyncPreview ? <div className="admin-sync-preview" role="status">
              <strong>{bookingSyncPreview.cancelledCount === 0 ? "No cancellations detected" : `${bookingSyncPreview.cancelledCount} booking${bookingSyncPreview.cancelledCount === 1 ? "" : "s"} marked for cancellation`}</strong>
              <span>{bookingSyncPreview.retainedCount} of {bookingSyncPreview.currentCount} current bookings will remain.</span>
              {bookingSyncPreview.requiresEmptyConfirmation ? <label className="admin-cancel-all-confirm"><input type="checkbox" checked={confirmCancelAll} onChange={event => setConfirmCancelAll(event.target.checked)} /> I understand this will cancel every active booking.</label> : null}
            </div> : null}
            <div className="admin-booking-sync-actions">
              <button className="admin-secondary-button admin-booking-action-button" type="button" onClick={previewBookingCsv} disabled={bookingActionBusy || !bookingCsvFile || !bookingSnapshotToken}>
                {bookingActionBusy ? <LoaderCircle className="spin" size={16} /> : <FileSpreadsheet size={16} />}
                Preview cancellation changes
              </button>
              {bookingSyncPreview && bookingSyncPreview.cancelledCount > 0 ? <button className="admin-primary-button admin-booking-action-button" type="button" onClick={applyBookingCsv} disabled={bookingActionBusy || (bookingSyncPreview.requiresEmptyConfirmation && !confirmCancelAll)}>
                {bookingActionBusy ? <LoaderCircle className="spin" size={16} /> : <UploadCloud size={16} />}
                Upload Updated Schedule
              </button> : null}
            </div>
            <p className="admin-booking-safety-note">Cancellations are applied in one database transaction. The signed export expires after two hours; download a fresh CSV if the bookings change.</p>
          </section>
          </>
        ) : authQuery.isError || adminSessionQuery.isError ? (
          <section className="admin-card admin-login-card" role="alert" aria-labelledby="admin-access-title">
            <div className="admin-card-icon"><LockKeyhole size={21} /></div>
            <h2 id="admin-access-title">Could not verify Admin access</h2>
            <p>Your account or Admin session could not be checked. Retry the secure role check before continuing.</p>
            <button className="admin-primary-button" type="button" onClick={() => { void Promise.all([authQuery.refetch(), adminSessionQuery.refetch()]); }}>Retry role check</button>
          </section>
        ) : (
          <section className="admin-card admin-login-card" role="status" aria-labelledby="admin-login-title">
            <div className="admin-card-icon"><LockKeyhole size={21} /></div>
            <h2 id="admin-login-title">Admin Password</h2>
            <p>Enter the Admin password configured through ROOMFINDER_ADMIN_PASSWORD or ADMIN_SECRET_KEY. The server verifies it and issues a short-lived, signed HttpOnly session.</p>
            <form className="admin-login-form" onSubmit={submitAdminPassword}>
              <label htmlFor="admin-password">Admin Password</label>
              <input id="admin-password" type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" minLength={20} maxLength={512} required disabled={busy} />
              <span className="admin-password-hint">Use the secure passphrase configured for this deployment.</span>
              <button className="admin-primary-button" type="submit" disabled={busy || password.length < 20}>
                {busy ? <LoaderCircle className="spin" size={17} /> : <ShieldCheck size={17} />}
                {busy ? "Verifying password…" : "Sign in as Admin"}
              </button>
            </form>
            <a className="admin-back-link admin-login-return" href="/">Return to staff room search</a>
          </section>
        )}
        {error ? <div className="admin-message admin-error" role="alert"><AlertCircle size={17} /><span>{error}</span></div> : null}
        {success ? <div className="admin-message admin-success" role="status"><CheckCircle2 size={18} /><span>{success}</span></div> : null}
      </main>
      <footer className="footer"><div className="footer-inner"><span>SPACERADAR <span className="footer-divider">/</span> ADMIN</span><span>Live schedule tools · Server-validated Excel</span></div></footer>
    </div>
  );
}
