export const WEEKS = ["A", "B"] as const;
export const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] as const;
export const PERIODS = [
  { id: "mentor", label: "Mentor Group" },
  { id: "lesson1", label: "Lesson 1" },
  { id: "lesson2", label: "Lesson 2" },
  { id: "lesson3", label: "Lesson 3" },
  { id: "lesson4", label: "Lesson 4" },
  { id: "lesson5", label: "Lesson 5" },
  { id: "lesson6", label: "Lesson 6" },
  { id: "lesson7", label: "Lesson 7" },
] as const;

export type Week = (typeof WEEKS)[number];
export type Day = (typeof DAYS)[number];
export type PeriodId = (typeof PERIODS)[number]["id"];

export const LAB_ROOM_NUMBERS = [
  "B301",
  "B304",
  "B303",
  "B305",
  "B401",
  "B404",
  "B403",
  "B501",
  "B601",
  "B602",
  "B603",
  "B605",
  "B606",
] as const;

export function isLabRoom(roomNumber: string): boolean {
  return LAB_ROOM_NUMBERS.some(room => room === roomNumber);
}

export const EXCLUDED_ROOM_NUMBERS = [
  "GLC",
  "Auditorium",
  "LT1",
  "LT2",
  "GLC glassroom",
  "A603",
  "A708",
] as const;
