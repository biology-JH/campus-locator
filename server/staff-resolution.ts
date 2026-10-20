import { LAB_ROOM_NUMBERS, type PeriodId } from "../shared/timetable.js";
import teacherAbbreviations from "./data/teacher-abbreviations.json" with { type: "json" };
import manualStaffOverrides from "./data/manual-staff-overrides.json" with { type: "json" };
import teacherSubjectRules from "./data/teacher-subject-rules.json" with { type: "json" };

type CourseRule = { grade: string; subject: string; names: string[] };
type StaffContextRule = {
  always?: string;
  byPeriod?: Partial<Record<PeriodId, string>>;
  excludeFromLessons?: string[];
  excludeFromRooms?: readonly string[];
  excludeNamesByGrade?: Record<string, string[]>;
};
type StaffLocation = { roomNumber: string; week: string; day: string };
type ManualStaffAssignment = { code: string; displayName: string };
type ManualStaffOverride = {
  room: string;
  week: string;
  day: string;
  period: string;
  occupant: string;
  code?: string;
  displayName?: string;
  staff?: ManualStaffAssignment[];
};

export type StaffAttribution = { code: string; names: string[] };

const staffByCode = new Map(
  Object.entries(teacherAbbreviations.byCode).map(([code, people]) => [
    code,
    people.map(person => person.displayName),
  ])
);
const coursesByCode = teacherSubjectRules.byCode as Record<
  string,
  CourseRule[]
>;
const manualOverridesByLocation = new Map(
  (manualStaffOverrides.overrides as ManualStaffOverride[]).map(override => [
    `${override.room}|${override.week}|${override.day}|${override.period}`,
    override,
  ])
);

// Direct rules reflect explicit user corrections for mentor groups, departed staff,
// no-lesson teachers, and the listed labs where Steve Hackman must not be attributed.
const staffContextRules: Record<string, StaffContextRule> = {
  BT: { byPeriod: { mentor: "Tao Jennifer Bian" } },
  LL: { byPeriod: { mentor: "Luke Leader" } },
  BB: { byPeriod: { mentor: "Brandon Burtts" } },
  VT: { byPeriod: { mentor: "Vaishali Tanna" } },
  YA: { always: "Anantha Yerikalapudi" },
  MS: {
    excludeFromLessons: ["Sarah Morrison"],
    excludeNamesByGrade: {
      "12": ["Shahzeb Mohammad"],
      "13": ["Shahzeb Mohammad"],
    },
  },
  YS: { excludeFromLessons: ["Yin Hung Sze"] },
  SH: {
    excludeFromRooms: LAB_ROOM_NUMBERS,
    excludeNamesByGrade: {
      "10": ["Steve Hackman"],
      "11": ["Steve Hackman"],
      "12": ["Steve Hackman"],
      "13": ["Steve Hackman"],
    },
  },
  JH: {
    excludeNamesByGrade: {
      "07": ["Joyce Ho"],
      "08": ["Joyce Ho"],
      "09": ["Joyce Ho"],
      "10": ["Joyce Ho"],
    },
  },
  PS: { excludeFromRooms: ["A203"] },
  YL: { excludeFromLessons: ["Yuki Liang"] },
};

type CourseContext = { grade: string; subject: string };

function getCourseContexts(occupant: string | null): CourseContext[] {
  const tokens = occupant?.toUpperCase().match(/[A-Z0-9]+/g) ?? [];
  const contexts = new Map<string, CourseContext>();
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const classToken = tokens[index] ?? "";
    if (!/^\d{2}[A-Z]?$/.test(classToken)) continue;
    const subject = (tokens[index + 1] ?? "").replace(/[^A-Z]/g, "");
    if (subject.length < 2) continue;
    const context = { grade: classToken.slice(0, 2), subject };
    contexts.set(`${context.grade}:${context.subject}`, context);
  }
  return [...contexts.values()];
}

function subjectMatches(pdfSubject: string, workbookSubject: string): boolean {
  if (pdfSubject === workbookSubject) return true;
  if (pdfSubject.length < 2 || workbookSubject.length < 2) return false;
  return (
    pdfSubject.startsWith(workbookSubject) ||
    workbookSubject.startsWith(pdfSubject)
  );
}

function sortedUnique(names: Iterable<string>): string[] {
  return [...new Set(names)].sort((left, right) => left.localeCompare(right));
}

function applyLessonExclusions(
  code: string,
  period: PeriodId,
  names: string[]
): string[] {
  const excluded = staffContextRules[code]?.excludeFromLessons;
  return sortedUnique(
    period !== "mentor" && excluded
      ? names.filter(name => !excluded.includes(name))
      : names
  );
}

function isCodeExcludedFromRoom(
  code: string,
  location: StaffLocation | undefined
): boolean {
  return Boolean(
    location &&
      staffContextRules[code]?.excludeFromRooms?.includes(location.roomNumber)
  );
}

function applyUserContextPreferences(
  occupant: string | null,
  resolved: StaffAttribution[]
): StaffAttribution[] {
  if (!occupant || resolved.length === 0) return resolved;
  const upper = occupant.toUpperCase();
  const tokens = (upper.match(/[A-Z0-9]+/g) ?? []) as string[];
  const has = (token: string) => tokens.includes(token);
  const hasGrade = (grade: string) =>
    tokens.some(token => token === grade || token.startsWith(grade));
  const hasLevel = (level: string) =>
    tokens.includes(level) ||
    (tokens.includes("L") && tokens.includes(level.replace("L", "")));
  const choose = (code: string, displayName: string) =>
    resolved.some(item => item.code === code)
      ? [{ code, names: [displayName] }]
      : resolved;
  const without = (...codes: string[]) =>
    resolved.filter(item => !codes.includes(item.code));

  if (
    upper.includes("07L S3 LL") &&
    resolved.some(item => item.code === "LL")
  ) {
    return choose("LL", "Luke Leader");
  }
  if (
    ((hasGrade("07") && has("MA") && has("T7") && has("JH") && has("A")) ||
      (hasGrade("08") && has("MA") && has("T8") && has("JH") && has("A")) ||
      (hasGrade("09") && has("MA") && has("T5") && has("JH") && has("A"))) &&
    resolved.some(item => item.code === "JH")
  ) {
    return choose("JH", "Jordan Hallas");
  }
  if (
    upper.includes("08L S6 LK") &&
    resolved.some(item => item.code === "LK")
  ) {
    return choose("LK", "Leanne Kingston");
  }
  if (
    upper.includes("11 GP 3 S H") &&
    resolved.some(item => item.code === "SH")
  ) {
    return choose("SH", "Steve Hackman");
  }
  if (
    upper.includes("13 MA AS L2 Y A") &&
    resolved.some(item => item.code === "YA")
  ) {
    return choose("YA", "Anantha Yerikalapudi");
  }
  if (
    upper.includes("12 SE HS HL 1 LF") &&
    resolved.some(item => item.code === "LF")
  ) {
    return choose("LF", "Lucy Ferris");
  }
  if (
    upper.includes("13 CHI SL 1 W O") &&
    resolved.some(item => item.code === "WO")
  ) {
    return choose("WO", "Onki Wong");
  }
  if (
    hasGrade("13") &&
    has("CHI") &&
    resolved.some(item => item.code === "SL") &&
    resolved.some(item => item.code === "WY")
  ) {
    return without("SL");
  }
  if (upper.includes("12F RB SL 1 A M")) {
    return without("SL");
  }
  if (
    hasGrade("12") &&
    has("EL") &&
    has("L1") &&
    resolved.some(item => item.code === "PC")
  ) {
    return choose("PC", "Philip Donald Chiaro");
  }
  if (
    hasGrade("13") &&
    has("EL") &&
    has("L3") &&
    resolved.some(item => item.code === "JB")
  ) {
    return choose("JB", "Janet Brooks");
  }
  if (
    has("EL") &&
    has("L3") &&
    hasGrade("12") &&
    resolved.some(item => item.code === "JB")
  ) {
    return without("LS");
  }
  if (has("EL") && has("HL") && (hasGrade("12") || hasGrade("13"))) {
    return without("SL");
  }
  if (
    has("CL") &&
    ((hasGrade("12") && hasLevel("L1")) ||
      (hasGrade("13") && (hasLevel("L2") || hasLevel("L4"))))
  ) {
    return without("LS");
  }
  if (hasGrade("12") && has("CHI") && (hasLevel("L2") || has("2"))) {
    return without("SL");
  }
  if (
    hasGrade("12") &&
    has("EN") &&
    has("L1") &&
    resolved.some(item => item.code === "GH")
  ) {
    return without("GH");
  }
  if (upper.includes("12 BU M SH J L3") || upper.includes("12 BU M SH L3 J")) {
    return choose("SH", "Jessika Mansen");
  }
  if (upper.includes("12 ES P SH M L1") || upper.includes("12 ES P SH M L2")) {
    return choose("SH", "Patrick Mcgovern");
  }
  if (
    hasGrade("12") &&
    has("BIO") &&
    has("C") &&
    has("1") &&
    resolved.some(item => item.code === "SL")
  ) {
    return choose("SL", "Harley Cunningham");
  }
  if (
    hasGrade("09") &&
    has("SCI") &&
    (has("6") || has("7")) &&
    resolved.some(item => item.code === "JH")
  ) {
    return choose("JH", "Jordan Hallas");
  }
  if (
    hasGrade("10") &&
    has("MA") &&
    has("RS") &&
    has("CI1") &&
    resolved.some(item => item.code === "JH")
  ) {
    return choose("JH", "Jordan Hallas");
  }
  if (
    hasGrade("12") &&
    has("MA") &&
    has("IHL") &&
    has("1") &&
    (resolved.some(item => item.code === "AKR") ||
      resolved.some(item => item.code === "AK"))
  ) {
    return resolved.some(item => item.code === "AKR")
      ? choose("AKR", "Alan Kenneth Ramm")
      : choose("AK", "Alan Kenneth Ramm");
  }
  if (
    hasGrade("12") &&
    has("MA") &&
    hasLevel("L1") &&
    resolved.some(item => item.code === "AS")
  ) {
    return without("AS");
  }
  if (
    hasGrade("10") &&
    has("GP") &&
    has("1") &&
    resolved.some(item => item.code === "SH")
  ) {
    return choose("SH", "Steve Hackman");
  }
  if (
    (hasGrade("12") && has("BU") && has("U") && has("L1")) ||
    (hasGrade("13") && has("BU") && has("U") && has("L2"))
  ) {
    return choose("SH", "Umer Babar");
  }
  if (upper.includes("12T HE C") && has("G") && has("1")) {
    return choose("SL", "Christy Greenfeather");
  }
  if (hasGrade("13") && has("HE") && has("B") && (has("1") || has("L1"))) {
    if (resolved.some(item => item.code === "SL")) {
      return choose("SL", "Brandi Burtts");
    }
    if (resolved.some(item => item.code === "BB")) {
      return choose("BB", "Brandi Burtts");
    }
  }
  if (
    upper.includes("13 BU M SH T L1") ||
    upper.includes("13 BU M SH T L3") ||
    upper.includes("13 BU M L1 T") ||
    upper.includes("13 BU M T L3")
  ) {
    return choose("SH", "Matthew Trethewey");
  }
  if (
    (hasGrade("12") || hasGrade("13")) &&
    has("DT") &&
    has("C") &&
    (has("1") || has("2")) &&
    (resolved.some(item => item.code === "SL") ||
      resolved.some(item => item.code === "SC"))
  ) {
    return resolved.some(item => item.code === "SC")
      ? choose("SC", "Sean Connaughton")
      : choose("SL", "Sean Connaughton");
  }
  if (
    hasGrade("13") &&
    has("DT") &&
    has("O") &&
    has("1") &&
    (resolved.some(item => item.code === "JO") ||
      resolved.some(item => item.code === "SL"))
  ) {
    return resolved.some(item => item.code === "JO")
      ? choose("JO", "John O'Brien")
      : choose("SL", "John O'Brien");
  }
  if (
    hasGrade("13") &&
    has("DT") &&
    has("1") &&
    resolved.some(item => item.code === "SL")
  ) {
    return without("SL");
  }

  if (resolved.some(item => item.code === "BD")) {
    if (upper.includes("08L")) {
      return choose("BD", "Deeksha Gokool Bhakarreea");
    }
    if (
      upper.includes("09F") ||
      upper.includes("09L") ||
      upper.includes("UNICORN") ||
      upper.includes("UNI COR N1")
    ) {
      return choose("BD", "Brendan Dunstan-Smith");
    }
  }
  if (
    hasGrade("12") &&
    has("ES") &&
    has("L3") &&
    resolved.some(item => item.code === "SH")
  ) {
    return resolved.filter(item => item.code !== "SH");
  }
  if (has("PHI") && resolved.some(item => item.code === "BL")) {
    return choose("BL", "Brian Liu");
  }
  if (
    hasGrade("12") &&
    has("CHI") &&
    resolved.some(item => item.code === "QA")
  ) {
    return choose("QA", "Ninghui Anastasia Qiu");
  }
  if (
    hasGrade("12") &&
    has("CL") &&
    has("L2") &&
    resolved.some(item => item.code === "ZY")
  ) {
    return choose("ZY", "Yuyang (yosef) Zhou");
  }
  if (
    hasGrade("13") &&
    has("EN") &&
    resolved.some(item => item.code === "CW")
  ) {
    return choose("CW", "Catherine Wu");
  }
  if (
    hasGrade("07") &&
    has("SCI") &&
    has("10") &&
    resolved.some(item => item.code === "JH")
  ) {
    return choose("JH", "Jordan Hallas");
  }
  if (
    hasGrade("12") &&
    has("CL") &&
    has("L3") &&
    resolved.some(item => item.code === "SSY")
  ) {
    return choose("SSY", "Shufan (sunny) Sun");
  }

  if (
    (upper.includes("10I E1") || upper.includes("11I E2")) &&
    resolved.some(item => item.code === "GP")
  )
    return choose("GP", "Paul Gillespie");
  if (has("EN") && resolved.some(item => item.code === "JD")) {
    return choose("JD", "Denise Josiah");
  }
  if (has("EL") && resolved.some(item => item.code === "EL")) {
    return choose("EL", "Eric Layman");
  }
  if (has("BIO") && resolved.some(item => item.code === "JJ")) {
    return choose("JJ", "Jacinta Lauren James");
  }
  if (has("HIS") && resolved.some(item => item.code === "LK")) {
    return choose("LK", "Kelsey Lowe");
  }
  if (
    (hasGrade("12") || hasGrade("13")) &&
    has("CL") &&
    resolved.some(item => item.code === "MMC")
  )
    return choose("MMC", "Margaret Chou");
  if (has("MA") && resolved.some(item => item.code === "KW")) {
    return choose("KW", "Wesley Koekemoer");
  }
  if (has("MA") && resolved.some(item => item.code === "NK")) {
    return choose("NK", "Naveen Kumar");
  }
  if (
    tokens.includes("X") &&
    tokens.includes("F") &&
    resolved.some(item => item.code === "XF")
  )
    return choose("XF", "Xinyao (yoyo) Feng");
  if (
    (hasGrade("12") || hasGrade("13")) &&
    resolved.some(item => item.code === "MS")
  )
    return choose("MS", "Mason Stewart");
  return resolved;
}

function removeBiologySamLingwood(
  occupant: string | null,
  resolved: StaffAttribution[]
): StaffAttribution[] {
  const contexts = getCourseContexts(occupant);
  if (!contexts.some(context => context.subject === "BIO")) return resolved;
  return resolved
    .map(attribution => ({
      ...attribution,
      names: attribution.names.filter(name => name !== "Sam Lingwood"),
    }))
    .filter(attribution => attribution.names.length > 0);
}

function excludeNamesByContext(
  code: string,
  occupant: string | null,
  names: string[]
): string[] {
  const rules = staffContextRules[code]?.excludeNamesByGrade;
  if (!rules) return names;
  const excluded = new Set(
    getCourseContexts(occupant).flatMap(context => rules[context.grade] ?? [])
  );
  return names.filter(name => !excluded.has(name));
}

function resolveFromWorkbook(
  code: string,
  occupant: string | null,
  period: PeriodId,
  candidates: string[]
): string[] {
  const rules = coursesByCode[code] ?? [];
  const matched = new Set<string>();
  for (const context of getCourseContexts(occupant)) {
    for (const rule of rules) {
      if (
        rule.grade !== context.grade ||
        !subjectMatches(context.subject, rule.subject)
      )
        continue;
      for (const name of rule.names) {
        if (candidates.includes(name)) matched.add(name);
      }
    }
  }
  return excludeNamesByContext(
    code,
    occupant,
    applyLessonExclusions(code, period, [...matched])
  );
}

function namesForCode(
  code: string,
  occupant: string | null,
  period: PeriodId
): string[] {
  const candidates = staffByCode.get(code) ?? [];
  const rule = staffContextRules[code];
  if (rule?.always) return [rule.always];

  const periodName = rule?.byPeriod?.[period];
  if (periodName) return [periodName];

  const workbookNames = resolveFromWorkbook(code, occupant, period, candidates);
  if (workbookNames.length > 0) return workbookNames;
  return excludeNamesByContext(
    code,
    occupant,
    applyLessonExclusions(code, period, candidates)
  );
}

export function staffForCodes(
  codes: string | null,
  occupant: string | null,
  period: PeriodId,
  location?: StaffLocation
): StaffAttribution[] {
  if (occupant && location) {
    const key = `${location.roomNumber}|${location.week}|${location.day}|${period}`;
    const override = manualOverridesByLocation.get(key);
    if (override && override.occupant === occupant) {
      const assignments =
        override.staff ??
        (override.code && override.displayName
          ? [{ code: override.code, displayName: override.displayName }]
          : []);
      return assignments
        .filter(
          assignment => !isCodeExcludedFromRoom(assignment.code, location)
        )
        .map(assignment => ({
          code: assignment.code,
          names: [assignment.displayName],
      }));
    }
  }

  if (
    occupant &&
    /\b13\s+BIO\s+C\b/i.test(occupant) &&
    /\bHL\b/i.test(occupant)
  ) {
    return [{ code: "CM", names: ["Caroline Jane Morgan"] }];
  }

  const resolved = (codes ?? "")
    .split(",")
    .filter(code => Boolean(code) && !isCodeExcludedFromRoom(code, location))
    .map(code => ({ code, names: namesForCode(code, occupant, period) }));
  return removeBiologySamLingwood(
    occupant,
    applyUserContextPreferences(occupant, resolved).filter(
      attribution => attribution.names.length > 0
    )
  );
}
