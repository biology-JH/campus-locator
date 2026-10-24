import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Building2,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Gauge,
  LoaderCircle,
  MapPin,
  RotateCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Users,
  UserRound,
} from "lucide-react";
import { DAYS, isLabRoom, PERIODS, WEEKS, type Day, type PeriodId, type Week } from "@shared/timetable";
import { capitalizeBracketedNames, isExcludedTeacherName } from "@shared/teacher-names";
import { trpc } from "@/lib/trpc";
import { hasAdminRole } from "@/lib/admin-access";
import { stageBatchAssignment, validateBatchDraft } from "@/lib/batch-schedule";

type View = "vacancy" | "room" | "teacher";
const PERIOD_TIME_RANGES: Record<PeriodId, string> = {
  mentor: "8:00 – 8:10",
  lesson1: "8:10 – 9:10",
  lesson2: "9:10 – 10:10",
  lesson3: "10:40 – 11:40",
  lesson4: "11:40 – 12:35",
  lesson5: "12:35 – 13:30",
  lesson6: "13:30 – 14:30",
  lesson7: "14:30 – 15:30",
};

function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <Building2 size={21} strokeWidth={2.1} />
      <span className="brand-mark-dot" />
    </span>
  );
}

function StatusPill({ status }: { status: "free" | "occupied" | "unknown" }) {
  const label = status === "free" ? "Open" : status === "occupied" ? "Busy" : "Not loaded";
  return (
    <span className={`status-pill status-${status}`}>
      {status === "free" ? <Check size={13} strokeWidth={2.6} /> : null}
      {label}
    </span>
  );
}

function LoadingBlock({ message }: { message: string }) {
  return (
    <div className="loading-block" role="status">
      <LoaderCircle className="spin" size={20} />
      <span>{message}</span>
    </div>
  );
}

function conciseRoomContent(occupantDisplay: string | null, occupant: string | null): string {
  const content = (occupantDisplay?.trim() || occupant?.trim() || "Free / no lesson").replace(/\s+/g, " ");
  const normalized = capitalizeBracketedNames(content);
  return normalized.length > 42 ? `${normalized.slice(0, 39)}…` : normalized;
}

function displayTeacherNames(value: string): string {
  return value.split(" / ")
    .map(capitalizeBracketedNames)
    .filter(name => !isExcludedTeacherName(name))
    .join(" / ");
}

export default function Home() {
  const [view, setView] = useState<View>("vacancy");
  const [week, setWeek] = useState<Week>("A");
  const [day, setDay] = useState<Day>("Monday");
  const [period, setPeriod] = useState<PeriodId>("lesson1");
  const [roomInput, setRoomInput] = useState("");
  const [roomFilter, setRoomFilter] = useState("");
  const [teacherInput, setTeacherInput] = useState("");
  const [isModifySchedule, setIsModifySchedule] = useState(false);
  const [batchDraft, setBatchDraft] = useState<Record<string, string>>({});
  const [batchRoomSearch, setBatchRoomSearch] = useState("");
  const [showBatchSaveConfirmation, setShowBatchSaveConfirmation] = useState(false);
  const [batchSaveNotice, setBatchSaveNotice] = useState("");
  const scheduleGridScrollRef = useRef<HTMLDivElement>(null);

  const authQuery = trpc.auth.me.useQuery(undefined, { retry: false, staleTime: 60_000, refetchOnWindowFocus: true });
  const adminSessionQuery = trpc.auth.adminSessionStatus.useQuery(undefined, { retry: false, staleTime: 0, refetchOnWindowFocus: true });
  const isAdmin = hasAdminRole(authQuery.data?.role) || adminSessionQuery.data?.isAdmin === true;
  const utils = trpc.useUtils();
  const roomsQuery = trpc.timetable.roomList.useQuery(undefined, { staleTime: 60_000 });
  const teachersQuery = trpc.timetable.teacherList.useQuery(undefined, { staleTime: 300_000 });
  const availabilityQuery = trpc.timetable.availability.useQuery(
    { week, day, period },
    { enabled: view === "vacancy", staleTime: 15_000 },
  );
  const rooms = roomsQuery.data ?? [];
  const selectedRoom = useMemo(
    () => rooms.find(room => room.roomNumber.toLowerCase() === roomInput.trim().toLowerCase()),
    [rooms, roomInput],
  );
  const masterQuery = trpc.timetable.masterSchedule.useQuery(
    { roomNumber: selectedRoom?.roomNumber ?? "" },
    { enabled: view === "room" && Boolean(selectedRoom), staleTime: 30_000 },
  );
  const availability = availabilityQuery.data;
  const activeWeekSchedule = masterQuery.data?.weeks.find(schedule => schedule.week === week);
  const teacherLocationsQuery = trpc.timetable.teacherLocations.useQuery(
    { teacher: teacherInput.trim(), week, day, period },
    { enabled: view === "teacher" && teacherInput.trim().length >= 2, staleTime: 15_000 },
  );
  const teachersForSlotQuery = trpc.timetable.teachersForSlot.useQuery(
    { week, day, period },
    { enabled: view === "teacher", staleTime: 30_000 },
  );
  const teacherOptions = useMemo(
    () => [...new Set((teachersQuery.data ?? []).map(capitalizeBracketedNames).filter(name => !isExcludedTeacherName(name)))],
    [teachersQuery.data],
  );
  const activeTeacherAssignments = useMemo(
    () => (teachersForSlotQuery.data?.activeTeachers ?? []).filter(assignment => displayTeacherNames(assignment.teacher)),
    [teachersForSlotQuery.data?.activeTeachers],
  );
  const freeTeacherNames = useMemo(
    () => (teachersForSlotQuery.data?.freeTeachers ?? []).map(capitalizeBracketedNames).filter(name => !isExcludedTeacherName(name)),
    [teachersForSlotQuery.data?.freeTeachers],
  );
  const teacherLocationMatches = useMemo(
    () => (teacherLocationsQuery.data?.matches ?? []).filter(match => displayTeacherNames(match.teacher)),
    [teacherLocationsQuery.data?.matches],
  );
  const batchEditQuery = trpc.timetable.batchEditSnapshot.useQuery(
    { week, day, period },
    { enabled: isAdmin && isModifySchedule, retry: false, staleTime: 0, refetchOnWindowFocus: false },
  );
  const saveBatchMutation = trpc.timetable.saveBatchScheduleChanges.useMutation({
    onSuccess: async result => {
      setBatchSaveNotice(`Saved ${result.updatedRooms} room ${result.updatedRooms === 1 ? "assignment" : "assignments"}.`);
      setIsModifySchedule(false);
      setShowBatchSaveConfirmation(false);
      await Promise.all([
        utils.timetable.availability.invalidate(),
        utils.timetable.masterSchedule.invalidate(),
        utils.timetable.teachersForSlot.invalidate(),
        utils.timetable.teacherLocations.invalidate(),
        utils.timetable.batchEditSnapshot.invalidate(),
      ]);
    },
  });
  const selectedPeriod = PERIODS.find(item => item.id === period)?.label ?? "Lesson 1";
  const scrollWeekdays = (direction: -1 | 1) => {
    const container = scheduleGridScrollRef.current;
    if (!container) return;
    container.scrollBy({
      left: direction * Math.max(240, Math.round(container.clientWidth * 0.75)),
      behavior: "smooth",
    });
  };
  const filteredFreeRooms = useMemo(() => {
    const query = roomFilter.trim().toLowerCase();
    if (!query) return availability?.freeRooms ?? [];
    return (availability?.freeRooms ?? []).filter(room => room.roomNumber.toLowerCase().includes(query));
  }, [availability?.freeRooms, roomFilter]);

  useEffect(() => {
    if (!isAdmin && isModifySchedule) {
      setIsModifySchedule(false);
      setBatchDraft({});
      setShowBatchSaveConfirmation(false);
    }
  }, [isAdmin, isModifySchedule]);

  useEffect(() => {
    if (!isModifySchedule) {
      setBatchDraft({});
      setBatchRoomSearch("");
      setShowBatchSaveConfirmation(false);
      return;
    }
    const snapshot = batchEditQuery.data;
    if (snapshot) {
      setBatchDraft(Object.fromEntries(snapshot.rooms.map(room => [room.roomNumber, room.roomNumber])));
      setShowBatchSaveConfirmation(false);
    }
  }, [isModifySchedule, batchEditQuery.data?.version]);

  const batchEditorRooms = batchEditQuery.data?.rooms ?? [];
  const batchValidation = useMemo(
    () => validateBatchDraft(batchEditorRooms.map(room => room.roomNumber), batchDraft),
    [batchEditorRooms, batchDraft],
  );
  const batchDraftReady = batchValidation.ready;
  const batchHasConflicts = batchValidation.hasConflicts;
  const batchHasChanges = batchValidation.hasChanges;
  const batchConflictRows = batchValidation.conflictRows;
  const batchRoomSearchTerm = batchRoomSearch.trim().toLocaleLowerCase();
  const filteredBatchEditorRooms = batchEditorRooms.filter(room => {
    if (!batchRoomSearchTerm) return true;
    const searchable = `${room.roomNumber} ${room.occupantDisplay ?? ""} ${room.occupant ?? ""}`.toLocaleLowerCase();
    return searchable.includes(batchRoomSearchTerm);
  });

  const openRoom = (roomNumber: string) => {
    setRoomInput(roomNumber);
    setView("room");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const resetFilters = () => {
    setWeek("A");
    setDay("Monday");
    setPeriod("lesson1");
    setRoomFilter("");
    setTeacherInput("");
  };

  const cancelBatchEditing = () => {
    setIsModifySchedule(false);
    setBatchDraft({});
    setBatchRoomSearch("");
    setShowBatchSaveConfirmation(false);
    setBatchSaveNotice("");
    saveBatchMutation.reset();
  };

  const toggleBatchEditing = () => {
    if (isModifySchedule) {
      if (batchHasChanges && !window.confirm("Discard the unsaved room-swap draft? No changes have been written.")) return;
      cancelBatchEditing();
      return;
    }
    saveBatchMutation.reset();
    setBatchSaveNotice("");
    setIsModifySchedule(true);
  };

  const confirmBatchSave = () => {
    const snapshot = batchEditQuery.data;
    if (!isAdmin || !snapshot || !batchDraftReady || batchHasConflicts || !batchHasChanges || saveBatchMutation.isPending) return;
    saveBatchMutation.mutate({
      week,
      day,
      period,
      expectedVersion: snapshot.version,
      assignments: batchEditorRooms.map(room => ({
        roomNumber: room.roomNumber,
        sourceRoomNumber: batchDraft[room.roomNumber],
      })),
    });
  };

  return (
    <div className="app-shell dashboard-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="#top" aria-label="Roomfinder home">
            <BrandMark />
            <span className="brand-copy">
              <strong>ROOMFINDER</strong>
              <span>TEACHER AVAILABILITY</span>
            </span>
          </a>
          <div className="topbar-actions">
            <div className="topbar-note">
              <span className="live-dot" />
              <span>Live timetable</span>
            </div>
            <a className="topbar-admin" href="/admin" aria-label="Open Admin Login">
              <ShieldCheck size={15} /> <span>Admin Login</span>
            </a>
          </div>
        </div>
      </header>

      <main id="top" className="main-content dashboard-page">
        <section className="dashboard-hero" aria-labelledby="page-title">
          <div>
            <div className="eyebrow"><Sparkles size={14} /> TEACHER & ROOM AVAILABILITY</div>
            <h1 id="page-title">Campus Space<br className="mobile-break" /> <span className="headline-ampersand">&amp;</span> Staff locator</h1>
            <p className="intro-copy">
              Integrated Room Allocation and Staff Directory.
            </p>
          </div>
          <figure className="hero-campus-card">
            <img src="/assets/roomfinder/ycis-building-exterior-hero.jpg" alt="Yew Chung International Secondary School building; its Chinese school name is unobstructed." />
            <figcaption className="hero-location-row">
              <MapPin size={14} aria-hidden="true" />
              <span>耀中國際學校 · Yew Chung International School Secondary · Kowloon Tong</span>
            </figcaption>
          </figure>
        </section>

        <div className="dashboard-layout">
          <aside className="filter-panel" aria-label="Availability filters">
            <div className="filter-panel-heading">
              <div className="filter-panel-icon"><SlidersHorizontal size={18} /></div>
              <div>
                <span className="panel-kicker">CONTROL PANEL</span>
                <h2>{view === "teacher" ? "Find a teacher" : "Find a room"}</h2>
                <p>{view === "teacher" ? "Search staff and check who is teaching or free." : "Set the moment, then scan the room board."}</p>
              </div>
            </div>

            <div className="view-switch dashboard-view-switch" role="tablist" aria-label="Room search mode">
              <button
                role="tab"
                aria-selected={view === "vacancy"}
                className={view === "vacancy" ? "view-tab active" : "view-tab"}
                onClick={() => setView("vacancy")}
              >
                <Gauge size={15} /><span>Availability</span>
              </button>
              <button
                role="tab"
                aria-selected={view === "room"}
                className={view === "room" ? "view-tab active" : "view-tab"}
                onClick={() => setView("room")}
              >
                <CalendarDays size={15} /><span>Room Schedule</span>
              </button>
              <button
                role="tab"
                aria-selected={view === "teacher"}
                className={view === "teacher" ? "view-tab active" : "view-tab"}
                onClick={() => setView("teacher")}
              >
                <UserRound size={15} /><span>Teacher Finder</span>
              </button>
            </div>

            {view === "teacher" ? (
              <section className="teacher-slot-panel" aria-labelledby="teacher-slot-title">
                <header className="teacher-slot-heading">
                  <div>
                    <span className="panel-kicker">TEACHER FINDER</span>
                    <h3 id="teacher-slot-title">Teachers for this slot</h3>
                    <p>{day} · {selectedPeriod} · Week {week}</p>
                  </div>
                  <span className="teacher-slot-icon" aria-hidden="true"><Users size={15} /></span>
                </header>
              </section>
            ) : null}

            {view !== "teacher" ? (
              <div className="filter-block">
                <label className="filter-label" htmlFor="room-filter">
                  <Search size={14} /> {view === "vacancy" ? "Search open rooms" : "Search a room"}
                </label>
                <div className="dashboard-search-field">
                  <Search size={17} aria-hidden="true" />
                  <input
                    id="room-filter"
                    type="search"
                    list="room-options"
                    value={view === "vacancy" ? roomFilter : roomInput}
                    onChange={event => view === "vacancy" ? setRoomFilter(event.target.value) : setRoomInput(event.target.value)}
                    placeholder={view === "vacancy" ? "Room number, e.g. A209" : "Enter a room number"}
                    autoComplete="off"
                  />
                  <datalist id="room-options">
                    {rooms.map(room => <option key={room.roomNumber} value={room.roomNumber} />)}
                  </datalist>
                </div>
              </div>
            ) : null}

            {view === "room" ? (
              <div className="filter-block">
                <label className="filter-label" htmlFor="room-picker"><Building2 size={14} /> Choose a room</label>
                <select id="room-picker" className="dashboard-room-select" value={selectedRoom?.roomNumber ?? ""} onChange={event => setRoomInput(event.target.value)}>
                  <option value="">Select a room number…</option>
                  {rooms.map(room => <option key={room.roomNumber} value={room.roomNumber}>{room.roomNumber}{isLabRoom(room.roomNumber) ? " · Lab" : ""}</option>)}
                </select>
              </div>
            ) : null}

            {view === "teacher" ? (
              <div className="filter-block">
                <label className="filter-label" htmlFor="teacher-filter"><UserRound size={14} /> Search a teacher</label>
                <div className="dashboard-search-field">
                  <UserRound size={17} aria-hidden="true" />
                  <input id="teacher-filter" type="search" value={teacherInput} onChange={event => setTeacherInput(event.target.value)} placeholder="e.g. Joyce Ho" autoComplete="off" />
                </div>
                <select id="teacher-picker" className="dashboard-room-select teacher-picker" value={teacherOptions.includes(capitalizeBracketedNames(teacherInput)) ? capitalizeBracketedNames(teacherInput) : ""} onChange={event => setTeacherInput(event.target.value)}>
                  <option value="">Select a staff member…</option>
                  {teacherOptions.map(teacher => <option key={teacher} value={teacher}>{teacher}</option>)}
                </select>
                <p className="filter-help">Searches the selected week, day, and period.</p>
              </div>
            ) : null}

            <div className="filter-divider" />

            <div className="filter-block filter-block-time">
              <div className="filter-label"><Clock3 size={14} /> Time slot</div>
              <label className="dashboard-field">
                <span>Week</span>
                <select value={week} disabled={isModifySchedule} onChange={event => setWeek(event.target.value as Week)}>
                  {WEEKS.map(value => <option key={value} value={value}>Week {value}</option>)}
                </select>
              </label>
              <label className="dashboard-field">
                <span>Day</span>
                <select value={day} disabled={isModifySchedule} onChange={event => setDay(event.target.value as Day)}>
                  {DAYS.map(value => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>
              <label className="dashboard-field">
                <span>Period</span>
                <select value={period} disabled={isModifySchedule} onChange={event => setPeriod(event.target.value as PeriodId)}>
                  {PERIODS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
              </label>
            </div>

            <button className="reset-filters" type="button" onClick={resetFilters} disabled={isModifySchedule}>
              <RotateCcw size={14} /> Reset filters
            </button>

            {isAdmin ? (
              <section className="batch-editor-panel" aria-labelledby="batch-editor-title">
                <header className="batch-editor-heading">
                  <div>
                    <span className="panel-kicker">ADMIN TOOLS</span>
                    <h3 id="batch-editor-title">Schedule editing</h3>
                    <p>{day} · {selectedPeriod} · Week {week}</p>
                  </div>
                  <button
                    type="button"
                    className={`batch-editor-toggle${isModifySchedule ? " is-on" : ""}`}
                    aria-pressed={isModifySchedule}
                    onClick={toggleBatchEditing}
                    disabled={saveBatchMutation.isPending}
                  >
                    <span>Modify Schedule</span>
                    <span className="batch-editor-toggle-state">{isModifySchedule ? "ON" : "OFF"}</span>
                  </button>
                </header>

                {batchSaveNotice ? <p className="batch-editor-success" role="status">{batchSaveNotice}</p> : null}

                {isModifySchedule ? (
                  <div className="batch-editor-content">
                    <p className="batch-editor-help">Stage as many room swaps as needed. Nothing is written until you confirm Save.</p>
                    <p className="batch-editor-shared-warning">
                      This Preview uses the shared Aiven timetable database also used by the live site. Confirming Save will update that shared schedule.
                    </p>

                    {batchEditQuery.isFetching ? (
                      <div className="batch-editor-state" role="status"><LoaderCircle className="spin" size={14} /> Loading the current slot…</div>
                    ) : null}
                    {batchEditQuery.isError ? (
                      <div className="batch-editor-state batch-editor-error" role="alert">
                        <span>{batchEditQuery.error.message}</span>
                        <button type="button" onClick={() => { void batchEditQuery.refetch(); }}>Retry</button>
                      </div>
                    ) : null}

                    {batchEditQuery.data && !batchEditQuery.isFetching ? (
                      <>
                        <label className="batch-editor-search-label" htmlFor="batch-room-search">Filter room rows</label>
                        <input
                          id="batch-room-search"
                          className="batch-editor-search"
                          type="search"
                          value={batchRoomSearch}
                          onChange={event => setBatchRoomSearch(event.target.value)}
                          placeholder="Room number or current class"
                          autoComplete="off"
                        />
                        <div className="batch-editor-summary">
                          <span>{batchEditorRooms.length} rooms in this slot</span>
                          <span>{batchHasChanges ? "Draft swaps staged" : "No unsaved changes"}</span>
                        </div>
                        <div className="batch-editor-room-list" role="list" aria-label={`Editable room assignments for ${day}, ${selectedPeriod}, Week ${week}`}>
                          {filteredBatchEditorRooms.map(room => {
                            const sourceRoom = batchDraft[room.roomNumber] ?? room.roomNumber;
                            const hasConflict = batchConflictRows.has(room.roomNumber);
                            const hasChanged = sourceRoom !== room.roomNumber;
                            return (
                              <div
                                className={`batch-editor-room-row${hasConflict ? " is-conflict" : ""}${hasChanged ? " is-changed" : ""}`}
                                key={room.roomNumber}
                                role="listitem"
                              >
                                <div className="batch-editor-room-current">
                                  <strong>{room.roomNumber}</strong>
                                  <small title={room.occupantDisplay ?? room.occupant ?? "Free / no lesson"}>
                                    {conciseRoomContent(room.occupantDisplay, room.occupant)}
                                  </small>
                                </div>
                                <select
                                  value={sourceRoom}
                                  aria-label={`New assignment for room ${room.roomNumber}`}
                                  aria-invalid={hasConflict}
                                  disabled={saveBatchMutation.isPending}
                                  onChange={event => {
                                    saveBatchMutation.reset();
                                    setShowBatchSaveConfirmation(false);
                                    setBatchDraft(previous => stageBatchAssignment(previous, room.roomNumber, event.target.value));
                                  }}
                                >
                                  {batchEditorRooms.map(source => (
                                    <option key={source.roomNumber} value={source.roomNumber}>
                                      {source.roomNumber} · {conciseRoomContent(source.occupantDisplay, source.occupant)}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            );
                          })}
                          {filteredBatchEditorRooms.length === 0 ? <p className="batch-editor-no-rooms">No rooms match this filter.</p> : null}
                        </div>

                        {batchDraftReady && batchHasConflicts ? (
                          <p className="batch-editor-conflict-note" role="alert">
                            Temporary room overlap in {batchConflictRows.size} row{batchConflictRows.size === 1 ? "" : "s"}. Use each original room assignment exactly once; highlighted rows must be resolved before saving.
                          </p>
                        ) : null}
                        {saveBatchMutation.error ? <p className="batch-editor-error-message" role="alert">{saveBatchMutation.error.message}</p> : null}

                        <div className="batch-editor-actions">
                          <button
                            type="button"
                            className="batch-editor-save"
                            onClick={() => setShowBatchSaveConfirmation(true)}
                            disabled={!batchHasChanges || batchHasConflicts || saveBatchMutation.isPending}
                          >
                            {saveBatchMutation.isPending ? "Saving…" : "Save Schedule Changes"}
                          </button>
                          <button
                            type="button"
                            className="batch-editor-cancel"
                            onClick={cancelBatchEditing}
                            disabled={saveBatchMutation.isPending}
                          >
                            Cancel
                          </button>
                        </div>

                        {showBatchSaveConfirmation ? (
                          <div className="batch-editor-confirmation" role="group" aria-labelledby="batch-confirm-title" aria-describedby="batch-confirm-copy">
                            <strong id="batch-confirm-title">Confirm shared schedule update</strong>
                            <p id="batch-confirm-copy">This saves the selected slot to Aiven, which is shared with the live timetable. The website code remains local, but the schedule data will change.</p>
                            <div>
                              <button type="button" className="batch-editor-cancel" onClick={() => setShowBatchSaveConfirmation(false)} disabled={saveBatchMutation.isPending}>Back to edits</button>
                              <button type="button" className="batch-editor-save" onClick={confirmBatchSave} disabled={saveBatchMutation.isPending || batchHasConflicts || !batchHasChanges}>
                                {saveBatchMutation.isPending ? "Saving…" : "Confirm & Save"}
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                ) : null}
              </section>
            ) : null}

          </aside>

          <section className="dashboard-results" aria-live="polite">
            {view === "teacher" && teacherInput.trim().length >= 2 ? (
              <section className="teacher-location-panel" aria-live="polite">
                <div className="teacher-location-heading">
                  <div>
                    <span className="panel-kicker">TEACHER LOCATION</span>
                    <h3>{capitalizeBracketedNames(teacherInput.trim())} · {day} · {selectedPeriod} · Week {week}</h3>
                  </div>
                  <UserRound size={20} />
                </div>
                {teacherLocationsQuery.isLoading ? <LoadingBlock message="Checking the teacher timetable…" /> : null}
                {teacherLocationsQuery.isError ? (
                  <div className="error-panel" role="alert">
                    <strong>Teacher search is unavailable.</strong>
                    <span>Try again after the timetable has loaded.</span>
                  </div>
                ) : null}
                {teacherLocationMatches.length ? (
                  <div className="teacher-location-list">
                    {teacherLocationMatches.map(match => (
                      <article className="teacher-location-card" key={`${match.roomNumber}-${match.week}-${match.day}-${match.period}`}>
                        <div className="teacher-location-room-box" role="group" aria-label={`Room ${match.roomNumber}`}>
                          <span>ROOM</span>
                          <Building2 size={20} aria-hidden="true" />
                          <strong>{match.roomNumber}</strong>
                        </div>
                        <div className="teacher-location-details">
                          <strong title={displayTeacherNames(match.teacher)}>{displayTeacherNames(match.teacher)}</strong>
                          <span
                            className="teacher-location-slot-inline"
                            title={`${match.day} - ${match.periodLabel} - Week ${match.week}`}
                          >
                            {match.day} - {match.periodLabel} - Week {match.week}
                          </span>
                          <small className="teacher-location-subject">
                            <b>Subject</b>
                            <span title={match.occupantDisplay ?? match.occupant ?? "Occupied timetable entry"}>
                              {capitalizeBracketedNames(match.occupantDisplay ?? match.occupant ?? "Occupied timetable entry")}
                            </span>
                          </small>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : null}
                {!teacherLocationsQuery.isLoading && !teacherLocationsQuery.isError && !teacherLocationsQuery.data?.matches.length ? (
                  <div className="teacher-location-empty"><UserRound size={18} /><span>{teacherInput.trim()} has no resolved room assignment for this selected time.</span></div>
                ) : null}
              </section>
            ) : null}

            {view === "teacher" ? (
              <section className="teacher-roster-panel" aria-labelledby="teacher-roster-title">
                <header className="teacher-roster-heading">
                  <div>
                    <span className="panel-kicker">TEACHER FINDER</span>
                    <h2 id="teacher-roster-title">Find a teacher's current room</h2>
                    <p>{day} · {selectedPeriod} · Week {week} · active and free staff</p>
                  </div>
                  <span className="teacher-roster-icon" aria-hidden="true"><Users size={20} /></span>
                </header>

                {teachersForSlotQuery.isLoading && !teachersForSlotQuery.data ? (
                  <div className="teacher-slot-state" role="status"><LoaderCircle className="spin" size={16} /> Loading teacher lists…</div>
                ) : null}

                {teachersForSlotQuery.isError && !teachersForSlotQuery.data ? (
                  <div className="teacher-slot-state teacher-slot-error" role="alert">
                    <span>Teacher availability could not be loaded.</span>
                    <button type="button" onClick={() => { void teachersForSlotQuery.refetch(); }}>Retry</button>
                  </div>
                ) : null}

                {teachersForSlotQuery.data ? (
                  <div className="teacher-slot-groups">
                    <section className="teacher-slot-group" aria-labelledby="active-teacher-list-title">
                      <div className="teacher-slot-group-heading">
                        <h3 id="active-teacher-list-title">Active Teachers</h3>
                        <span className="teacher-slot-count">{activeTeacherAssignments.length}</span>
                      </div>
                      <ul className="teacher-slot-list" aria-label={`Active teachers for ${day}, ${selectedPeriod}, Week ${week}`}>
                        {activeTeacherAssignments.length ? activeTeacherAssignments.map((assignment, index) => (
                          <li className="teacher-slot-row" key={`${assignment.roomNumber}-${assignment.teacher}-${index}`}>
                            <span className="teacher-slot-name" title={displayTeacherNames(assignment.teacher)}>
                              {assignment.isAmbiguous ? `Possible: ${displayTeacherNames(assignment.teacher)}` : displayTeacherNames(assignment.teacher)}
                            </span>
                            <span className="teacher-slot-chip teacher-slot-room" title={`Assigned room ${assignment.roomNumber}`}>{assignment.roomNumber}</span>
                          </li>
                        )) : <li className="teacher-slot-empty">No resolved teacher assignments for this slot.</li>}
                      </ul>
                    </section>

                    <section className="teacher-slot-group" aria-labelledby="free-teacher-list-title">
                      <div className="teacher-slot-group-heading">
                        <h3 id="free-teacher-list-title">Free Teachers</h3>
                        <span className="teacher-slot-count teacher-slot-count-free">{freeTeacherNames.length}</span>
                      </div>
                      <ul className="teacher-slot-list" aria-label={`Free teachers for ${day}, ${selectedPeriod}, Week ${week}`}>
                        {freeTeacherNames.length ? freeTeacherNames.map(teacher => (
                          <li className="teacher-slot-row" key={teacher}>
                            <span className="teacher-slot-name" title={displayTeacherNames(teacher)}>{displayTeacherNames(teacher)}</span>
                            <span className="teacher-slot-chip teacher-slot-free-chip">Free</span>
                          </li>
                        )) : <li className="teacher-slot-empty">No free teachers listed for this slot.</li>}
                      </ul>
                    </section>
                  </div>
                ) : null}
              </section>
            ) : null}

            {view === "vacancy" ? (
              <>
                <div className="results-toolbar">
                  <div>
                    <span className="panel-kicker">ROOM BOARD</span>
                    <h2>What’s open right now?</h2>
                    <p>{day} · {selectedPeriod} · Week {week}</p>
                  </div>
                  <div className="board-status"><span className="live-dot" /> Updated from timetable</div>
                </div>

                <div className="status-summary-grid">
                  <article className="summary-card summary-open">
                    <div className="summary-card-top"><span>OPEN ROOMS</span><Check size={16} /></div>
                    <strong>{availability?.freeRooms.length ?? 0}</strong>
                    <p>Ready for scheduling in this slot</p>
                  </article>
                  <article className="summary-card summary-busy">
                    <div className="summary-card-top"><span>BUSY NOW</span><Users size={16} /></div>
                    <strong>{availability?.occupiedCount ?? 0}</strong>
                    <p>Occupied rooms in the timetable</p>
                  </article>
                  <article className="summary-card summary-total">
                    <div className="summary-card-top"><span>ROOMS TRACKED</span><Building2 size={16} /></div>
                    <strong>{availability?.totalRooms ?? rooms.length}</strong>
                    <p>Excluded spaces are hidden</p>
                  </article>
                </div>

                {roomsQuery.isLoading ? <LoadingBlock message="Loading the school room list…" /> : null}
                {roomsQuery.isError ? (
                  <div className="error-panel" role="alert">
                    <strong>The timetable could not be loaded.</strong>
                    <span>Check the server connection and confirm that the timetable has been imported into the database.</span>
                    <button className="text-button" onClick={() => roomsQuery.refetch()}>Try again</button>
                  </div>
                ) : null}
                {availabilityQuery.isError ? (
                  <div className="error-panel" role="alert">
                    <strong>Availability is unavailable.</strong>
                    <span>The database did not return the selected timetable slot.</span>
                    <button className="text-button" onClick={() => availabilityQuery.refetch()}>Refresh results</button>
                  </div>
                ) : availabilityQuery.isFetching && !availability ? (
                  <LoadingBlock message="Checking room availability…" />
                ) : null}
                {availability?.incompleteCount ? (
                  <p className="data-warning" role="status">
                    {availability.incompleteCount} room schedule {availability.incompleteCount === 1 ? "record is" : "records are"} missing, so those rooms are not counted as open.
                  </p>
                ) : null}

                <div className="board-section-heading">
                  <div>
                    <span className="panel-kicker">OPEN ROOM TILES</span>
                    <h3>{filteredFreeRooms.length} {filteredFreeRooms.length === 1 ? "room" : "rooms"} match your filters</h3>
                  </div>
                </div>

                {filteredFreeRooms.length ? (
                  <div className="bento-grid">
                    {filteredFreeRooms.map(room => (
                      <article className="room-tile room-tile-open" key={room.roomNumber}>
                        <div className="room-tile-top">
                          <div className="room-tile-icon"><Building2 size={19} /></div>
                          <span className="room-state room-state-open"><span /> Open</span>
                        </div>
                        <div className="room-tile-main">
                          <span className="room-tile-kicker">{isLabRoom(room.roomNumber) ? "Science lab" : "Classroom"}</span>
                          <h4>{room.roomNumber}</h4>
                          <p>Available for {selectedPeriod}</p>
                        </div>
                        <button className="room-tile-action" type="button" onClick={() => openRoom(room.roomNumber)}>
                          <span>View schedule</span><ArrowUpRight size={16} />
                        </button>
                      </article>
                    ))}
                  </div>
                ) : availability && !availabilityQuery.isError && !availabilityQuery.isLoading ? (
                  <div className="empty-state room-board-empty">
                    <span className="empty-icon"><Building2 size={25} /></span>
                    <h3>{roomFilter ? "No open rooms match that search" : "No rooms are open for this slot"}</h3>
                    <p>Try another period or clear the room search to see more options.</p>
                  </div>
                ) : null}

                <div className="busy-callout">
                  <div className="busy-callout-icon"><Users size={18} /></div>
                  <div>
                    <strong>{availability?.occupiedCount ?? 0} rooms are busy in this slot</strong>
                    <p>Open a room schedule to see the current class and teacher attribution, including exact-context matches.</p>
                  </div>
                  <button type="button" onClick={() => setView("room")}>Browse schedules <ArrowUpRight size={15} /></button>
                </div>

                {availability && availability.totalRooms > 0 ? (
                  <div className="results-footnote dashboard-footnote">
                    <span><span className="legend-dot free-dot" /> Open</span>
                    <span><span className="legend-dot occupied-dot" /> Busy</span>
                    <span>{availability.totalRooms} rooms in the timetable</span>
                  </div>
                ) : null}
              </>
            ) : view === "room" ? (
              <section className="master-section dashboard-master-section" aria-labelledby="master-title">
                <div className="results-toolbar master-toolbar">
                  <div>
                    <span className="panel-kicker">ROOM MASTER SCHEDULE</span>
                    <h2>Who is in the room?</h2>
                    <p>Switch weeks to view the room timetable.</p>
                  </div>
                  <button className="back-link" type="button" onClick={() => setView("vacancy")}>
                    <ArrowLeft size={16} /> Back to room board
                  </button>
                </div>
                {!roomInput.trim() ? (
                  <div className="empty-state room-prompt">
                    <span className="empty-icon"><Search size={24} /></span>
                    <h3>Start with a room number</h3>
                    <p>Choose any room in the left panel to view its full schedule for both alternating weeks.</p>
                  </div>
                ) : !selectedRoom && !roomsQuery.isLoading ? (
                  <div className="empty-state room-prompt">
                    <span className="empty-icon"><Search size={24} /></span>
                    <h3>Room not found</h3>
                    <p>Check the room number or choose one from the suggestions.</p>
                  </div>
                ) : masterQuery.isLoading ? (
                  <LoadingBlock message="Loading the complete room timetable…" />
                ) : masterQuery.isError ? (
                  <div className="error-panel" role="alert">
                    <strong>That room’s timetable could not be loaded.</strong>
                    <button className="text-button" onClick={() => masterQuery.refetch()}>Try again</button>
                  </div>
                ) : masterQuery.data ? (
                  <>
                    <div className="master-heading">
                      <div className="master-title-row">
                        <div>
                          <div className="eyebrow results-eyebrow">SELECTED ROOM</div>
                          <h3 id="master-title">
                            {masterQuery.data.roomNumber}
                            {isLabRoom(masterQuery.data.roomNumber) ? <span className="room-type-badge">Lab</span> : null}
                          </h3>
                          <p>Every weekday · Week {week}.</p>
                        </div>
                        <div className="source-stamp">SOURCE PDF · PAGE {masterQuery.data.sourcePage}</div>
                      </div>
                    </div>
                    <div className="week-schedule-list">
                      <div className="schedule-week-tabs" role="tablist" aria-label="Room schedule week">
                        {WEEKS.map(weekTab => (
                          <button
                            aria-controls="schedule-week-panel"
                            aria-selected={week === weekTab}
                            className={week === weekTab ? "schedule-week-tab active" : "schedule-week-tab"}
                            id={`schedule-week-tab-${weekTab}`}
                            key={weekTab}
                            onClick={() => setWeek(weekTab)}
                            onKeyDown={event => {
                              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                                event.preventDefault();
                                const nextWeek = weekTab === "A" ? "B" : "A";
                                setWeek(nextWeek);
                                document.getElementById(`schedule-week-tab-${nextWeek}`)?.focus();
                              }
                            }}
                            role="tab"
                            tabIndex={week === weekTab ? 0 : -1}
                            type="button"
                          >
                            Week {weekTab}
                          </button>
                        ))}
                      </div>
                      {activeWeekSchedule ? (
                        <section
                          aria-labelledby={`schedule-week-tab-${week}`}
                          className="week-block schedule-week-panel"
                          id="schedule-week-panel"
                          role="tabpanel"
                        >
                          <div className="week-block-heading">
                            <div className="week-ribbon">WEEK {week}</div>
                            <h3>Week {week}</h3>
                            <span>Monday – Friday · Mentor Group + 7 lessons</span>
                          </div>
                          <div className="schedule-scroll-toolbar">
                            <div className="schedule-scroll-instruction">
                              <strong>Scroll through Monday–Friday</strong>
                              <span>Swipe, use a trackpad, or select an arrow to view every weekday.</span>
                            </div>
                            <div className="schedule-scroll-actions" role="group" aria-label="Weekday scroll controls">
                              <button
                                aria-label="Scroll to earlier weekdays"
                                onClick={() => scrollWeekdays(-1)}
                                title="Scroll to earlier weekdays"
                                type="button"
                              >
                                <ChevronLeft size={17} aria-hidden="true" />
                              </button>
                              <button
                                aria-label="Scroll to later weekdays"
                                onClick={() => scrollWeekdays(1)}
                                title="Scroll to later weekdays"
                                type="button"
                              >
                                <ChevronRight size={17} aria-hidden="true" />
                              </button>
                            </div>
                          </div>
                          <div
                            aria-label={`Week ${week} timetable. Scroll horizontally to view all weekdays.`}
                            className="schedule-grid-scroll"
                            ref={scheduleGridScrollRef}
                            role="region"
                            tabIndex={0}
                          >
                            <div className="schedule-grid">
                              <div className="schedule-column-heading schedule-time-heading">PERIOD / TIME</div>
                              {activeWeekSchedule.days.map(daySchedule => (
                                <div className="schedule-column-heading" key={daySchedule.day}>{daySchedule.day}</div>
                              ))}
                              {PERIODS.map(periodInfo => (
                                <div className="schedule-grid-row" key={periodInfo.id}>
                                  <div className="schedule-time-cell">
                                    <strong>{periodInfo.label}</strong>
                                    <span>{PERIOD_TIME_RANGES[periodInfo.id]}</span>
                                  </div>
                                  {activeWeekSchedule.days.map(daySchedule => {
                                    const slot = daySchedule.slots.find(item => item.period === periodInfo.id);
                                    const slotStatus = !slot || !slot.hasRecord
                                      ? "unknown"
                                      : slot.isOccupied ? "occupied" : "free";
                                    const occupant = capitalizeBracketedNames(slot?.occupantDisplay ?? slot?.occupant ?? "Occupied timetable entry");
                                    const staffAttributions = (slot?.staff ?? []).map(staff => ({
                                      ...staff,
                                      names: [...new Set(staff.names.map(capitalizeBracketedNames))].filter(name => !isExcludedTeacherName(name)),
                                    })).filter(staff => staff.names.length > 0);

                                    return (
                                      <article
                                        aria-label={`${daySchedule.day}, ${periodInfo.label}, ${PERIOD_TIME_RANGES[periodInfo.id]}, ${slotStatus}`}
                                        className="period-row schedule-period-card"
                                        key={`${daySchedule.day}-${periodInfo.id}`}
                                      >
                                        <div className="period-row-heading">
                                          <span title={periodInfo.label}>{periodInfo.label}</span>
                                          <StatusPill status={slotStatus} />
                                        </div>
                                        {slot?.isOccupied ? (
                                          <div className="occupant-block">
                                            <p className="occupant-code" title={occupant}>
                                              <span className="subject-label">Subject</span>{occupant}
                                            </p>
                                            {staffAttributions.length ? (
                                              <div className="staff-attribution">
                                                <span className="staff-attribution-label">Teacher</span>
                                                <ul>
                                                  {staffAttributions.map(staff => (
                                                    <li
                                                      className={staff.names.length === 1 ? "staff-chip" : "staff-chip staff-chip-ambiguous"}
                                                      key={`${periodInfo.id}-${staff.code}`}
                                                      title={`${staff.code}: ${staff.names.length ? staff.names.join(" / ") : "No full name found"}`}
                                                    >
                                                      {staff.names.length === 1 ? (
                                                        displayTeacherNames(staff.names[0])
                                                      ) : (
                                                        <>
                                                          <strong>{staff.code}</strong>
                                                          <span>
                                                            {staff.names.length
                                                              ? `Possible matches: ${displayTeacherNames(staff.names.join(" / "))}`
                                                              : "No full name found in the supplied staff list"}
                                                          </span>
                                                        </>
                                                      )}
                                                    </li>
                                                  ))}
                                                </ul>
                                              </div>
                                            ) : (
                                              <p className="staff-unmatched">No staff abbreviation matched this entry.</p>
                                            )}
                                          </div>
                                        ) : !slot || !slot.hasRecord ? (
                                          <p className="occupant-missing">Schedule record not loaded</p>
                                        ) : null}
                                      </article>
                                    );
                                  })}
                                </div>
                              ))}
                            </div>
                          </div>
                        </section>
                      ) : (
                        <div className="empty-state room-prompt" role="status">
                          <h3>No schedule data for Week {week}</h3>
                          <p>Choose the other week tab or refresh the room timetable.</p>
                        </div>
                      )}
                    </div>
                    <p className="code-note">
                      Full names use the supplied staff list. Duplicate initials are shown as possible matches for staff to verify.
                    </p>
                  </>
                ) : null}
              </section>
            ) : null}
          </section>
        </div>
      </main>

      <footer className="footer">
        <div className="footer-inner">
          <span>ROOMFINDER <span className="footer-divider">/</span> TEACHER STAFF TOOL</span>
          <div className="footer-credit">
            <img src="/assets/roomfinder/ms-joyce-ho.gif" alt="" />
            <span>Created by Ms. Joyce Ho</span>
          </div>
          <span>Schedule source: Summary timetable · 18 Oct</span>
        </div>
      </footer>
    </div>
  );
}
