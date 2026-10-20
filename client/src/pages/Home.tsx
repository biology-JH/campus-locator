import { useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Building2,
  CalendarDays,
  Check,
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
import { trpc } from "@/lib/trpc";

type View = "vacancy" | "room";
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

export default function Home() {
  const [view, setView] = useState<View>("vacancy");
  const [week, setWeek] = useState<Week>("A");
  const [day, setDay] = useState<Day>("Monday");
  const [period, setPeriod] = useState<PeriodId>("lesson1");
  const [roomInput, setRoomInput] = useState("");
  const [roomFilter, setRoomFilter] = useState("");
  const [teacherInput, setTeacherInput] = useState("");

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
  const teacherLocationsQuery = trpc.timetable.teacherLocations.useQuery(
    { teacher: teacherInput.trim(), week, day, period },
    { enabled: teacherInput.trim().length >= 2, staleTime: 15_000 },
  );
  const selectedPeriod = PERIODS.find(item => item.id === period)?.label ?? "Lesson 1";
  const filteredFreeRooms = useMemo(() => {
    const query = roomFilter.trim().toLowerCase();
    if (!query) return availability?.freeRooms ?? [];
    return (availability?.freeRooms ?? []).filter(room => room.roomNumber.toLowerCase().includes(query));
  }, [availability?.freeRooms, roomFilter]);

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
            <a className="topbar-admin" href="/admin" aria-label="Open timetable administration">
              <ShieldCheck size={15} /> Admin
            </a>
          </div>
        </div>
      </header>

      <main id="top" className="main-content dashboard-page">
        <section className="dashboard-hero" aria-labelledby="page-title">
          <div>
            <div className="eyebrow"><Sparkles size={14} /> TEACHER & ROOM AVAILABILITY</div>
            <h1 id="page-title">Campus Space<br className="mobile-break" /> <span className="headline-ampersand">&amp;</span> Staff Locator</h1>
            <p className="intro-copy">
              Integrated Room Allocation and Staff Directory.
            </p>
          </div>
          <figure className="hero-campus-card">
            <img src="/assets/roomfinder/campus.jpg" alt="耀中國際學校，Yew Chung International School campus" />
            <figcaption>
              <span className="hero-context-icon"><MapPin size={18} /></span>
              <span>
                <strong>耀中國際學校 · Yew Chung International School</strong>
                <small>Secondary · Kowloon Tong</small>
              </span>
            </figcaption>
          </figure>
        </section>

        <div className="learning-space-strip" aria-label="Learning spaces around campus">
          <figure><img src="/assets/roomfinder/classroom.png" alt="Bright classroom with desks and presentation screen" /><figcaption>Classrooms</figcaption></figure>
          <figure><img src="/assets/roomfinder/corridor.png" alt="School corridor with classroom doors" /><figcaption>Find your next room</figcaption></figure>
          <figure><img src="/assets/roomfinder/science-lab.png" alt="Modern science laboratory" /><figcaption>Science labs</figcaption></figure>
        </div>

        <div className="dashboard-layout">
          <aside className="filter-panel" aria-label="Availability filters">
            <div className="filter-panel-heading">
              <div className="filter-panel-icon"><SlidersHorizontal size={18} /></div>
              <div>
                <span className="panel-kicker">CONTROL PANEL</span>
                <h2>Find a room</h2>
                <p>Set the moment, then scan the room board.</p>
              </div>
            </div>

            <div className="view-switch dashboard-view-switch" role="tablist" aria-label="Room search mode">
              <button
                role="tab"
                aria-selected={view === "vacancy"}
                className={view === "vacancy" ? "view-tab active" : "view-tab"}
                onClick={() => setView("vacancy")}
              >
                <Gauge size={16} /> Availability
              </button>
              <button
                role="tab"
                aria-selected={view === "room"}
                className={view === "room" ? "view-tab active" : "view-tab"}
                onClick={() => setView("room")}
              >
                <CalendarDays size={16} /> Room schedule
              </button>
            </div>

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

            {view === "room" ? (
              <div className="filter-block">
                <label className="filter-label" htmlFor="room-picker"><Building2 size={14} /> Choose a room</label>
                <select id="room-picker" className="dashboard-room-select" value={selectedRoom?.roomNumber ?? ""} onChange={event => setRoomInput(event.target.value)}>
                  <option value="">Select a room number…</option>
                  {rooms.map(room => <option key={room.roomNumber} value={room.roomNumber}>{room.roomNumber}{isLabRoom(room.roomNumber) ? " · Lab" : ""}</option>)}
                </select>
              </div>
            ) : null}

            <div className="filter-block">
              <label className="filter-label" htmlFor="teacher-filter"><UserRound size={14} /> Search a teacher</label>
              <div className="dashboard-search-field">
                <UserRound size={17} aria-hidden="true" />
                <input id="teacher-filter" type="search" value={teacherInput} onChange={event => setTeacherInput(event.target.value)} placeholder="e.g. Joyce Ho" autoComplete="off" />
              </div>
              <select id="teacher-picker" className="dashboard-room-select teacher-picker" value={teachersQuery.data?.includes(teacherInput) ? teacherInput : ""} onChange={event => setTeacherInput(event.target.value)}>
                <option value="">Select a staff member…</option>
                {(teachersQuery.data ?? []).map(teacher => <option key={teacher} value={teacher}>{teacher}</option>)}
              </select>
              <p className="filter-help">Searches the selected week, day, and period.</p>
            </div>

            <div className="filter-divider" />

            <div className="filter-block filter-block-time">
              <div className="filter-label"><Clock3 size={14} /> Time slot</div>
              <label className="dashboard-field">
                <span>Week</span>
                <select value={week} onChange={event => setWeek(event.target.value as Week)}>
                  {WEEKS.map(value => <option key={value} value={value}>Week {value}</option>)}
                </select>
              </label>
              <label className="dashboard-field">
                <span>Day</span>
                <select value={day} onChange={event => setDay(event.target.value as Day)}>
                  {DAYS.map(value => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>
              <label className="dashboard-field">
                <span>Period</span>
                <select value={period} onChange={event => setPeriod(event.target.value as PeriodId)}>
                  {PERIODS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
              </label>
            </div>

            <button className="reset-filters" type="button" onClick={resetFilters}>
              <RotateCcw size={14} /> Reset filters
            </button>

          </aside>

          <section className="dashboard-results" aria-live="polite">
            {teacherInput.trim().length >= 2 ? (
              <section className="teacher-location-panel" aria-live="polite">
                <div className="teacher-location-heading"><div><span className="panel-kicker">TEACHER LOCATION</span><h3>{teacherInput.trim()} · {day} · {selectedPeriod} · Week {week}</h3></div><UserRound size={20} /></div>
                {teacherLocationsQuery.isLoading ? <LoadingBlock message="Checking the teacher timetable…" /> : teacherLocationsQuery.isError ? <div className="error-panel" role="alert"><strong>Teacher search is unavailable.</strong><span>Try again after the timetable has loaded.</span></div> : teacherLocationsQuery.data?.matches.length ? <div className="teacher-location-list">{teacherLocationsQuery.data.matches.map(match => <article className="teacher-location-card" key={`${match.roomNumber}-${match.week}-${match.day}-${match.period}`}><div className="teacher-location-room"><span>ROOM</span><Building2 size={21} /><strong>{match.roomNumber}</strong></div><div className="teacher-location-details"><strong>{match.teacher}</strong><span>{match.day} · {match.periodLabel} · Week {match.week}</span><small><b>Subject</b>{match.occupantDisplay ?? match.occupant ?? "Occupied timetable entry"}</small></div></article>)}</div> : <div className="teacher-location-empty"><UserRound size={18} /><span>{teacherInput.trim()} has no resolved room assignment for this selected time.</span></div>}
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
            ) : (
              <section className="master-section dashboard-master-section" aria-labelledby="master-title">
                <div className="results-toolbar master-toolbar">
                  <div>
                    <span className="panel-kicker">ROOM MASTER SCHEDULE</span>
                    <h2>Who is in the room?</h2>
                    <p>Full timetable with teacher attribution for both alternating weeks.</p>
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
                          <p>Every weekday, across both alternating weeks.</p>
                        </div>
                        <div className="source-stamp">SOURCE PDF · PAGE {masterQuery.data.sourcePage}</div>
                      </div>
                    </div>
                    <div className="week-schedule-list">
                      {masterQuery.data.weeks.map(weekSchedule => (
                        <section className="week-block" key={weekSchedule.week} aria-labelledby={`week-${weekSchedule.week}`}>
                          <div className="week-block-heading">
                            <div className="week-ribbon">WEEK {weekSchedule.week}</div>
                            <h3 id={`week-${weekSchedule.week}`}>Week {weekSchedule.week}</h3>
                            <span>Monday – Friday · Mentor Group + 7 lessons</span>
                          </div>
                          <div className="day-grid">
                            {weekSchedule.days.map(daySchedule => (
                              <article className="day-card" key={daySchedule.day}>
                                <h4>{daySchedule.day}</h4>
                                <ul className="period-list">
                                  {daySchedule.slots.map(slot => (
                                    <li className="period-row" key={slot.period}>
                                      <div className="period-row-heading">
                                        <span>{slot.label}</span>
                                        <StatusPill status={!slot.hasRecord ? "unknown" : slot.isOccupied ? "occupied" : "free"} />
                                      </div>
                                      {slot.isOccupied ? (
                                        <div className="occupant-block">
                                          <p className="occupant-code">
                                            <span className="subject-label">Subject</span>{slot.occupantDisplay ?? slot.occupant}
                                          </p>
                                          {slot.staff.length ? (
                                            <div className="staff-attribution">
                                              <span className="staff-attribution-label">Teacher</span>
                                              <ul>
                                                {slot.staff.map(staff => (
                                                  <li
                                                    className={staff.names.length === 1 ? "staff-chip" : "staff-chip staff-chip-ambiguous"}
                                                    key={`${slot.period}-${staff.code}`}
                                                  >
                                                    {staff.names.length === 1 ? (
                                                      staff.names[0]
                                                    ) : (
                                                      <>
                                                        <strong>{staff.code}</strong>
                                                        <span>
                                                          {staff.names.length
                                                            ? `Possible matches: ${staff.names.join(" / ")}`
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
                                      ) : !slot.hasRecord ? (
                                        <p className="occupant-missing">Schedule record not loaded</p>
                                      ) : null}
                                    </li>
                                  ))}
                                </ul>
                              </article>
                            ))}
                          </div>
                        </section>
                      ))}
                    </div>
                    <p className="code-note">
                      Full names use the supplied staff list. Duplicate initials are shown as possible matches for staff to verify.
                    </p>
                  </>
                ) : null}
              </section>
            )}
          </section>
        </div>
      </main>

      <footer className="footer">
        <div className="footer-inner">
          <span>ROOMFINDER <span className="footer-divider">/</span> TEACHER STAFF TOOL</span>
          <span>Schedule source: Summary timetable · 18 Oct</span>
        </div>
      </footer>
    </div>
  );
}
