import { useMemo, useState } from "react";
import { CalendarDays, CheckCircle2, DoorOpen, LoaderCircle, ShieldCheck } from "lucide-react";
import { isLabRoom, PERIODS, type PeriodId } from "@shared/timetable";
import { trpc } from "@/lib/trpc";

function todayInHongKong(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find(value => value.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export default function RoomBookingPanel() {
  const today = useMemo(todayInHongKong, []);
  const [date, setDate] = useState(today);
  const [period, setPeriod] = useState<PeriodId>("lesson1");
  const [teacherName, setTeacherName] = useState("");
  const [roomId, setRoomId] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const utils = trpc.useUtils();

  const roomQuery = trpc.timetable.roomList.useQuery(undefined, { staleTime: 60_000 });
  const teacherQuery = trpc.timetable.teacherList.useQuery(undefined, { staleTime: 300_000 });
  const slotQuery = trpc.bookings.slotReservations.useQuery({ date, period }, { retry: false, staleTime: 15_000 });
  const slot = slotQuery.data;
  const availabilityQuery = trpc.timetable.availability.useQuery(
    slot ? { week: slot.scheduleWeek, day: slot.weekday, period } : { week: "A", day: "Monday", period },
    { enabled: Boolean(slot), staleTime: 10_000 },
  );
  const createBooking = trpc.bookings.create.useMutation({
    onSuccess: async booking => {
      setSuccessMessage(`${booking.roomNumber} is reserved for ${booking.teacherName} · ${booking.weekday}, Period ${booking.period.replace("lesson", "").replace("mentor", "Mentor Group")} · Week ${booking.scheduleWeek}.`);
      setRoomId("");
      await Promise.all([
        utils.bookings.slotReservations.invalidate({ date, period }),
        utils.timetable.availability.invalidate(),
      ]);
    },
  });

  const reservations = slot?.reservations ?? [];
  const reservedRoomIds = useMemo(() => new Set(reservations.map(reservation => reservation.roomId)), [reservations]);
  const freeRoomNumbers = useMemo(() => new Set((availabilityQuery.data?.freeRooms ?? []).map(room => room.roomNumber)), [availabilityQuery.data?.freeRooms]);
  const availableRooms = useMemo(
    () => (roomQuery.data ?? []).filter(room => freeRoomNumbers.has(room.roomNumber) && !reservedRoomIds.has(room.id)),
    [roomQuery.data, freeRoomNumbers, reservedRoomIds],
  );
  const selectedRoom = availableRooms.find(room => String(room.id) === roomId);
  const teachers = teacherQuery.data ?? [];
  const selectedTeacher = teachers.find(teacher => teacher === teacherName) ?? "";
  const busy = slotQuery.isLoading || availabilityQuery.isLoading || roomQuery.isLoading || teacherQuery.isLoading;
  const submitDisabled = busy || createBooking.isPending || !slot || !selectedRoom || !selectedTeacher;

  function submitBooking(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSuccessMessage("");
    createBooking.reset();
    if (!slot || !selectedRoom || !selectedTeacher) return;
    createBooking.mutate({ date, period, roomId: selectedRoom.id, teacherName: selectedTeacher });
  }

  return (
    <section className="room-booking" aria-labelledby="booking-title">
      <header className="room-booking-heading">
        <div>
          <span className="panel-kicker">ROOM BOOKING</span>
          <h2 id="booking-title">Reserve a teaching space</h2>
          <p>Choose a school date; the server assigns its Week A/B cycle and weekday.</p>
        </div>
        <span className="room-booking-heading-icon" aria-hidden="true"><CalendarDays size={20} /></span>
      </header>

      <p className="booking-cycle-note">
        Reservations repeat on the selected Week A/B weekday and period. Choose a date from the correct calendar week; this is not a one-time date booking.
      </p>

      <div className="room-booking-columns">
        <form className="room-booking-form" onSubmit={submitBooking}>
          <h3>New room reservation</h3>
          <label className="booking-field" htmlFor="booking-date">
            <span>School date</span>
            <input id="booking-date" type="date" value={date} min={today} onChange={event => { setDate(event.target.value); setSuccessMessage(""); createBooking.reset(); }} required />
          </label>
          <div className="booking-slot-preview" aria-live="polite">
            {slot ? (
              <><strong>Week {slot.scheduleWeek}</strong><span>{slot.weekday} · {slot.periodLabel}</span></>
            ) : slotQuery.isLoading ? (
              <><LoaderCircle size={16} className="spin" /><span>Checking the school-week cycle…</span></>
            ) : (
              <><CalendarDays size={16} /><span>Week/day will appear after the calendar cycle is configured.</span></>
            )}
          </div>
          <label className="booking-field" htmlFor="booking-period">
            <span>Class period</span>
            <select id="booking-period" value={period} onChange={event => { setPeriod(event.target.value as PeriodId); setRoomId(""); setSuccessMessage(""); createBooking.reset(); }}>
              {PERIODS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <label className="booking-field" htmlFor="booking-teacher">
            <span>Teacher</span>
            <select id="booking-teacher" value={teacherName} onChange={event => { setTeacherName(event.target.value); setSuccessMessage(""); createBooking.reset(); }} required>
              <option value="">Select your name…</option>
              {teachers.map(teacher => <option key={teacher} value={teacher}>{teacher}</option>)}
            </select>
          </label>
          <label className="booking-field" htmlFor="booking-room">
            <span>Available room</span>
            <select id="booking-room" value={roomId} onChange={event => { setRoomId(event.target.value); setSuccessMessage(""); createBooking.reset(); }} required disabled={!slot || availabilityQuery.isLoading || availableRooms.length === 0}>
              <option value="">Select an open room…</option>
              {availableRooms.map(room => (
                <option key={room.id} value={room.id}>
                  {room.roomNumber}{isLabRoom(room.roomNumber) ? " · Lab" : ""}
                </option>
              ))}
            </select>
          </label>

          {slotQuery.isError ? <p className="booking-error" role="alert">{slotQuery.error.message}</p> : null}
          {availabilityQuery.isError ? <p className="booking-error" role="alert">Room availability could not be checked. Please retry.</p> : null}
          {roomQuery.isError || teacherQuery.isError ? <p className="booking-error" role="alert">The room or staff list could not be loaded. Please refresh the page.</p> : null}
          {slot && !busy && availableRooms.length === 0 && !availabilityQuery.isError ? <p className="booking-empty">No timetable-free rooms remain for this recurring slot.</p> : null}
          {createBooking.error ? <p className="booking-error" role="alert">{createBooking.error.message}</p> : null}
          {successMessage ? <p className="booking-success" role="status"><CheckCircle2 size={16} />{successMessage}</p> : null}

          <button className="booking-submit" type="submit" disabled={submitDisabled}>
            {createBooking.isPending ? <LoaderCircle size={16} className="spin" /> : <ShieldCheck size={16} />}
            {createBooking.isPending ? "Saving reservation…" : "Confirm room booking"}
          </button>
          <p className="booking-security-note"><ShieldCheck size={13} /> Booking actions require the shared site-password session.</p>
        </form>

        <section className="booking-reservations" aria-labelledby="booking-reservations-title">
          <header>
            <div>
              <h3 id="booking-reservations-title">Already reserved</h3>
              <p>{slot ? `Week ${slot.scheduleWeek} · ${slot.weekday} · ${slot.periodLabel}` : "Select a valid school date to view reservations."}</p>
            </div>
            <span className="booking-reservation-count">{reservations.length}</span>
          </header>
          {slotQuery.isLoading ? <div className="booking-list-state" role="status"><LoaderCircle size={15} className="spin" /> Loading reservations…</div> : null}
          {slotQuery.isError ? <div className="booking-list-state">Reservations are unavailable for the selected school date.</div> : null}
          {slot && !slotQuery.isLoading && reservations.length === 0 ? <div className="booking-list-empty"><DoorOpen size={20} /><span>No reservations have been made for this slot.</span></div> : null}
          {reservations.length > 0 ? (
            <ul className="booking-reservation-list">
              {reservations.map(reservation => (
                <li className="booking-reservation-row" key={reservation.id}>
                  <span className="booking-room-number">{reservation.roomNumber}</span>
                  <span className="booking-reservation-teacher">{reservation.teacherName}</span>
                  <span className="booking-reservation-week">Week {slot?.scheduleWeek}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="booking-double-book-note">A room/Week/day/period database constraint blocks duplicates, including simultaneous submissions.</p>
        </section>
      </div>
    </section>
  );
}
