import { describe, expect, it } from "vitest";
import { LAB_ROOM_NUMBERS } from "../shared/timetable";
import manualStaffOverrides from "./data/manual-staff-overrides.json";
import timetableData from "./data/timetable.json";
import { staffForCodes } from "./staff-resolution";

type PeriodId = Parameters<typeof staffForCodes>[2];

const roomsByName = new Map(timetableData.rooms.map(room => [room.room, room]));

function names(code: string, occupant: string, period: PeriodId) {
  return staffForCodes(code, occupant, period)[0]?.names ?? [];
}

function resolveCell(
  roomNumber: string,
  week: string,
  day: string,
  period: PeriodId
) {
  const cell = roomsByName
    .get(roomNumber)
    ?.schedule.find(
      entry =>
        entry.week === week && entry.day === day && entry.period === period
    );
  const codes = cell?.staffCodes.length ? cell.staffCodes.join(",") : null;
  return staffForCodes(codes, cell?.occupant ?? null, period, {
    roomNumber,
    week,
    day,
  });
}

describe("staffForCodes", () => {
  it("matches BT and LL by grade and course rather than initials alone", () => {
    expect(names("BT", "09 MA T7 BT", "lesson1")).toEqual([
      "Tao Jennifer Bian",
    ]);
    expect(names("BT", "07 SCI 6 BT", "lesson1")).toEqual(["Brian Totman"]);
    expect(names("LL", "08 MA T2 LL", "lesson1")).toEqual(["Lily Lin"]);
    expect(names("LL", "07 SCI 7 LL", "lesson1")).toEqual(["Luke Leader"]);
    expect(names("LL", "07 PT 7 LL", "lesson1")).toEqual(["Luke Leader"]);
    expect(names("BT", "Mentor BT", "mentor")).toEqual(["Tao Jennifer Bian"]);
  });

  it("uses grade/course rows for drama, art, pastoral time, and other subjects", () => {
    expect(names("BB", "09 DRA 2 BB", "lesson1")).toEqual(["Brandi Burtts"]);
    expect(names("BB", "09 HIS 2 BB", "lesson1")).toEqual(["Brandon Burtts"]);
    expect(names("BB", "Mentor BB", "mentor")).toEqual(["Brandon Burtts"]);
    expect(names("BD", "10 ART 2 BD", "lesson1")).toEqual([
      "Deeksha Gokool Bhakarreea",
    ]);
    expect(names("BD", "09 FS 2 BD", "lesson1")).toEqual([
      "Brendan Dunstan-Smith",
    ]);
    expect(names("BD", "08 PT 2 BD", "lesson1")).toEqual([
      "Deeksha Gokool Bhakarreea",
    ]);
  });

  it("uses English, CUG, Chinese, and Chemistry course codes from the workbook", () => {
    expect(names("GP", "10 IE 3 GP", "lesson1")).toEqual(["Paul Gillespie"]);
    expect(names("GP", "10 CU 2 GP", "lesson1")).toEqual(["Prachi Gupta"]);
    expect(names("GP", "13 CAS 2 GP", "lesson1")).toEqual(["Prachi Gupta"]);
    expect(names("HR", "07 SCI 9 HR", "lesson1")).toEqual(["Hannah Roberts"]);
    expect(names("HR", "08 CS 5 HR", "lesson1")).toEqual(["Runlin He"]);
    expect(names("HR", "13 CH 4 HR", "lesson1")).toEqual(["Hannah Roberts"]);
  });

  it("resolves art/history, physics/science/coding, DT, and computer science", () => {
    expect(names("LK", "08 VA 3 LK", "lesson1")).toEqual(["Leanne Kingston"]);
    expect(names("LK", "11 HIS 4 LK", "lesson1")).toEqual(["Kelsey Lowe"]);
    expect(names("LK", "07 SS 3 LK", "lesson1")).toEqual(["Kelsey Lowe"]);
    expect(names("LK", "08 PT 3 LK", "lesson1")).toEqual(["Leanne Kingston"]);
    expect(names("MS", "12 PHY 2 MS", "lesson1")).toEqual(["Mason Stewart"]);
    expect(names("MS", "09 COD 2 MS", "lesson1")).toEqual(["Shahzeb Mohammad"]);
    expect(names("MS", "08 ET 4 MS", "lesson1")).toEqual(["Shahzeb Mohammad"]);
    expect(names("SC", "12 DT 5 SC", "lesson1")).toEqual(["Sean Connaughton"]);
    expect(names("VT", "09 COD 5 VT", "lesson1")).toEqual(["Vaishali Tanna"]);
    expect(names("VT", "11 CS 5 VT", "lesson1")).toEqual(["Vaishali Tanna"]);
    expect(names("VT", "Mentor VT", "mentor")).toEqual(["Vaishali Tanna"]);
  });

  it("replaces departed Yvonne with Anantha and hides excluded staff from all slots", () => {
    expect(names("YA", "08 MAT T2 YA", "lesson1")).toEqual([
      "Anantha Yerikalapudi",
    ]);
    expect(names("MS", "08 UNKNOWN 4 MS", "lesson1")).toEqual([
      "Mason Stewart",
      "Shahzeb Mohammad",
    ]);
    expect(names("YS", "09 MU 5 YS", "lesson1")).toEqual([]);
    expect(names("YS", "Mentor YS", "mentor")).toEqual([]);
    expect(names("GM", "Mentor GM", "mentor")).toEqual([]);
    expect(names("RK", "Mentor RK", "mentor")).toEqual([]);
  });

  it("applies the Year 12–13 MS exclusion and Yuki's no-lesson rule", () => {
    expect(names("MS", "12 CH M MS G L3", "lesson1")).toEqual([
      "Mason Stewart",
    ]);
    expect(names("MS", "13 CH M MS G L3", "lesson1")).toEqual([
      "Mason Stewart",
    ]);
    expect(names("YL", "13 MUS 1 YL", "lesson1")).toEqual([]);
    expect(names("YL", "Mentor YL", "mentor")).toEqual(["Yuki Liang"]);
  });

  it("retains multiple staff when the workbook lists both for the same class and course", () => {
    expect(names("PS", "07 MUS 2 PS", "lesson1")).toEqual([
      "Paul Stanley",
      "Peter Stapleton",
    ]);
    expect(names("PS", "12 MUS 2 PS", "lesson1")).toEqual(["Peter Stapleton"]);
  });

  it("does not attribute Steve Hackman to any listed Lab room", () => {
    for (const roomNumber of LAB_ROOM_NUMBERS) {
      expect(
        staffForCodes("SH", "13 ES SH L1", "lesson1", {
          roomNumber,
          week: "A",
          day: "Monday",
        })
      ).toEqual([]);
    }

    expect(
      staffForCodes("SH", "13 ES SH L1", "lesson1", {
        roomNumber: "A209",
        week: "A",
        day: "Monday",
      })
    ).toEqual([]);
  });

  it("removes Steve from later-year Business and suppresses empty YS", () => {
    expect(names("SH", "12 BU SH L2", "lesson1")).toEqual([]);
    expect(names("SH", "09 HIS SH L1", "lesson1")).toEqual(["Steve Hackman"]);
    expect(staffForCodes("YS", "13 PH D YS L2 N", "lesson1")).toEqual([]);
  });

  it("applies the latest English, Science, Chinese, and name corrections", () => {
    expect(names("KG", "Mentor KG", "mentor")).toEqual(["Kouaho (Guy) Gueye"]);
    expect(names("XF", "Mentor XF", "mentor")).toEqual(["Xinyao (Yoyo) Feng"]);
    expect(names("GH,CW", "13 EN GH L3 C W", "lesson1")).toEqual([
      "Catherine Wu",
    ]);
    expect(names("JH", "07 SCI 10 JH A", "lesson1")).toEqual(["Jordan Hallas"]);
    expect(names("LS,SSY", "12 CL LS L3 S S Y", "lesson1")).toEqual([
      "Shufan (Sunny) Sun",
    ]);
    expect(names("JH", "12 BIO HL JH 3 J H", "lesson1")).toEqual(["Joyce Ho"]);
    expect(names("OB", "12 BU OB", "lesson1")).toEqual(["Ben O'Donnell"]);
  });

  it("applies the latest timetable-specific staff corrections", () => {
    expect(names("LL", "07L S3 LL", "lesson7")).toEqual(["Luke Leader"]);
    expect(names("JH", "07 MA T7 JH A", "lesson1")).toEqual(["Jordan Hallas"]);
    expect(names("JH", "08 MA T8 JH A", "lesson1")).toEqual(["Jordan Hallas"]);
    expect(names("JH", "09 MA T5 JH A", "lesson1")).toEqual(["Jordan Hallas"]);
    expect(resolveCell("A307", "B", "Wednesday", "lesson1")).toEqual([
      { code: "BD", names: ["Brendan Dunstan-Smith"] },
    ]);
    expect(resolveCell("A408", "A", "Tuesday", "lesson7")).toEqual([
      { code: "SH", names: ["Steve Hackman"] },
    ]);
    expect(resolveCell("A302", "A", "Monday", "lesson3")).toEqual([
      { code: "HY", names: ["Hazel Yuen"] },
    ]);
    expect(resolveCell("A605", "A", "Monday", "lesson1")).toEqual([
      { code: "LM", names: ["Lauren Minnie"] },
    ]);
    expect(names("FG", "12 EN GH L1 F G", "lesson1")).toEqual(["Gareth Flint"]);
    expect(names("MA", "13 EN GH L1 M A", "lesson1")).toEqual([
      "Amulya Malaki",
    ]);
    expect(names("SL,WO", "13 CHI SL 1 W O", "lesson1")).toEqual(["Onki Wong"]);
    expect(names("SL,WY", "13 CHI SL 2 W Y", "lesson1")).toEqual([
      "Yang (Rick) Wang",
    ]);
    expect(names("SL,AM", "12F RB SL 1 A M", "lesson1")).toEqual([
      "Adrien Marie-Francoise",
    ]);
    expect(resolveCell("A403", "B", "Monday", "lesson2")).toEqual([
      { code: "LF", names: ["Lucy Ferris"] },
    ]);
    expect(resolveCell("A203", "A", "Monday", "lesson7")).toEqual([
      { code: "SE", names: ["Sarah Emberger"] },
    ]);
    expect(names("LS,PC", "12 EL LS L1 P C", "lesson1")).toEqual([
      "Philip Donald Chiaro",
    ]);
    expect(names("LS,JB", "13 EL LS JB L3 13 EL LH L3 JB", "lesson1")).toEqual([
      "Janet Brooks",
    ]);
    expect(names("CJ,SL", "12 EL HL CJ 1 12 EL SL CJ 1", "lesson1")).toEqual([
      "James Carnaby",
    ]);
    expect(names("JO", "11 EN JO", "lesson1")).toEqual(["John O'Brien"]);
  });

  it("applies the latest subject exclusions and teacher selections", () => {
    expect(names("LS,ZJW", "12 CL LS L1 ZJ W", "lesson1")).toEqual([
      "Zhen Jane Wang",
    ]);
    expect(names("LS,ZJW", "13 CL LS L 4 ZJ W", "lesson1")).toEqual([
      "Zhen Jane Wang",
    ]);
    expect(names("LS,HS", "13 CL LS L 2 H S", "lesson1")).toEqual(["Suea Han"]);
    expect(names("SL,ZLU", "12 CHI SL 2 ZL U", "lesson1")).toEqual([
      "Lu (Lucy) Zhang",
    ]);
    expect(names("GH,FG", "12 EN GH L1 F G", "lesson1")).toEqual([
      "Gareth Flint",
    ]);
    expect(names("SH", "12 BU M SH J L3 12 BU M SS J L3", "lesson1")).toEqual([
      "Jessika Mansen",
    ]);
    expect(names("SH", "12 ES P SS M L2 12 ES P SH M L2", "lesson1")).toEqual([
      "Patrick Mcgovern",
    ]);
    expect(names("VT", "Sa bret oot h5 VT", "mentor")).toEqual([
      "Vaishali Tanna",
    ]);
    expect(names("SH", "13 BU M SS T L3 13 BU M SH T L3", "lesson1")).toEqual([
      "Matthew Trethewey",
    ]);
  });

  it("applies the latest Biology, Mathematics, Higher Education, and Art rules", () => {
    expect(names("SH", "12 BU B SH U L1 12 BU B SS U L1", "lesson1")).toEqual([
      "Umer Babar",
    ]);
    expect(names("SH", "13 BU B SH U L2 13 BU B SS U L2", "lesson1")).toEqual([
      "Umer Babar",
    ]);
    expect(names("SL", "12 BIO H HL C 1 12 BIO H SL C 1", "lesson1")).toEqual([
      "Harley Cunningham",
    ]);
    expect(names("JH", "09 SCI 7 JH A", "lesson1")).toEqual(["Jordan Hallas"]);
    expect(names("JH", "09 SCI 6 JH A", "lesson1")).toEqual(["Jordan Hallas"]);
    expect(names("JH", "10 MA RS CI1 JH A", "lesson1")).toEqual([
      "Jordan Hallas",
    ]);
    expect(names("AKR", "12 MA IHL 1 A K R", "lesson1")).toEqual([
      "Alan Kenneth Ramm",
    ]);
    expect(names("AS,JW", "12 MA AS L1 J W", "lesson1")).toEqual([
      "Jenny Wang",
    ]);
    expect(names("SH", "10 GP 1 S H", "lesson1")).toEqual(["Steve Hackman"]);
    expect(names("SL", "12T HE C SL G 1 12T HE C HL G 1", "lesson1")).toEqual([
      "Christy Greenfeather",
    ]);
    expect(names("SL", "13T HE B HL B 1 13T HE B SL B 1", "lesson1")).toEqual([
      "Brandi Burtts",
    ]);
    expect(
      names("CM,SL", "13 BIO C M 1 13 BIO C HL", "lesson1")
    ).toEqual(["Caroline Jane Morgan"]);
    expect(
      names("SL", "13 BIO C SL M 1 13 BIO C HL M 1", "lesson1")
    ).toEqual(["Caroline Jane Morgan"]);
    expect(names("SL", "13 BIO 1 SL", "lesson1")).toEqual([]);
    expect(
      names("SL", "12 BIO H HL C 1 12 BIO H SL C 1", "lesson1")
    ).toEqual(["Harley Cunningham"]);
    expect(resolveCell("Art3", "A", "Monday", "lesson2")).toEqual([
      { code: "JAT", names: ["Jacques Alain Thomass"] },
    ]);
  });

  it("applies the latest DT and Higher Education corrections", () => {
    expect(names("SL", "13 DT S HL C 2 13 DT S SL C 2", "lesson1")).toEqual([
      "Sean Connaughton",
    ]);
    expect(names("SL", "12 DT S SL C 1 12 DT S HL C 1", "lesson1")).toEqual([
      "Sean Connaughton",
    ]);
    expect(names("JO", "13 DT HL 1 J O", "lesson1")).toEqual(["John O'Brien"]);
    expect(names("SL", "13 DT J SL O 1 13 DT J HL O 1", "lesson1")).toEqual([
      "John O'Brien",
    ]);
    expect(names("BB", "13T HE HL 1 B B", "lesson1")).toEqual([
      "Brandi Burtts",
    ]);
  });

  it("applies the user-supplied Patrick, Caroline, Stephanie, Curtis, and Craig corrections", () => {
    expect(resolveCell("B304", "B", "Friday", "lesson4")).toEqual([
      { code: "PM", names: ["Patrick Mcgovern"] },
    ]);
    expect(resolveCell("B303", "A", "Monday", "lesson2")).toEqual([
      { code: "CM", names: ["Caroline Jane Morgan"] },
    ]);
    expect(resolveCell("B401", "A", "Wednesday", "lesson4")).toEqual([
      { code: "SV", names: ["Stephanie Visser"] },
      { code: "CC", names: ["Curtis Chung"] },
    ]);
    expect(resolveCell("B605", "A", "Monday", "lesson2")).toEqual([
      { code: "SV", names: ["Stephanie Visser"] },
      { code: "CC", names: ["Curtis Chung"] },
    ]);
    expect(resolveCell("B301", "A", "Monday", "lesson6")).toEqual([
      { code: "CB", names: ["Craig Billington"] },
    ]);
    expect(resolveCell("B404", "A", "Monday", "lesson4")).toEqual([
      { code: "CM", names: ["Caroline Jane Morgan"] },
    ]);
    expect(resolveCell("B301", "A", "Tuesday", "lesson1")).toEqual([
      { code: "BG", names: ["Billy Grindley"] },
    ]);
    expect(resolveCell("B301", "A", "Thursday", "lesson4")).toEqual([
      { code: "MS", names: ["Mason Stewart"] },
    ]);
    expect(resolveCell("B301", "A", "Friday", "lesson1")).toEqual([
      { code: "SKI", names: ["Samuel Kim"] },
    ]);
    expect(resolveCell("B301", "A", "Wednesday", "lesson4")).toEqual([
      { code: "SKE", names: ["Simon Kelleher"] },
    ]);
  });

  it("applies each explicit name only at its exact room, slot, and source text", () => {
    for (const override of manualStaffOverrides.overrides) {
      const details = override as typeof override & {
        staff?: Array<{ code: string; displayName: string }>;
        code?: string;
        displayName?: string;
      };
      const cell = roomsByName
        .get(override.room)
        ?.schedule.find(
          entry =>
            entry.week === override.week &&
            entry.day === override.day &&
            entry.period === override.period
        );

      expect(cell?.occupant).toBe(override.occupant);
      const codes = cell?.staffCodes.length ? cell.staffCodes.join(",") : null;
      expect(
        staffForCodes(
          codes,
          cell?.occupant ?? null,
          override.period as PeriodId,
          {
            roomNumber: override.room,
            week: override.week,
            day: override.day,
          }
        )
      ).toEqual(
        details.staff
          ? details.staff.map(assignment => ({
              code: assignment.code,
              names: [assignment.displayName],
            }))
          : [{ code: details.code, names: [details.displayName] }]
      );
    }
  });

  it("applies the room-specific PS assignments and Paul Gillespie’s Integrated English correction", () => {
    expect(resolveCell("B408", "A", "Tuesday", "lesson3")).toEqual([
      { code: "PS", names: ["Paul Stanley"] },
    ]);
    expect(resolveCell("B513", "A", "Monday", "lesson6")).toEqual([
      { code: "PS", names: ["Peter Stapleton"] },
    ]);
    expect(resolveCell("B513", "A", "Thursday", "lesson1")).toEqual([
      { code: "PS", names: ["Paul Stanley"] },
    ]);
    expect(resolveCell("B513", "B", "Tuesday", "lesson3")).toEqual([
      { code: "PS", names: ["Paul Stanley"] },
    ]);
    expect(resolveCell("B607", "A", "Tuesday", "lesson3")).toEqual([
      { code: "GP", names: ["Paul Gillespie"] },
    ]);
  });

  it("applies the latest exact Saraswati, Phoenix, and Shanmuga corrections", () => {
    const expected = [
      {
        occupants: ["12 PS A YS S L3 12 PS A YH S L3"],
        code: "AS",
        name: "Saraswati Austin",
        count: 6,
      },
      {
        occupants: ["Ph oen ix5 G P"],
        code: "GP",
        name: "Paul Gillespie",
        count: 12,
      },
      {
        occupants: [
          "13 S PS V YS R L1 13 S PS V YH R L1",
          "13 S PS V YS L1 R 13 S PS V YH R L1",
        ],
        code: "SVR",
        name: "Shanmuga Vadivu Ramasamy",
        count: 6,
      },
    ];
    for (const rule of expected) {
      const matches = timetableData.rooms.flatMap(room =>
        room.schedule
          .filter(cell => rule.occupants.includes(cell.occupant ?? ""))
          .map(cell =>
            resolveCell(room.room, cell.week, cell.day, cell.period as PeriodId)
          )
      );
      expect(matches).toHaveLength(rule.count);
      expect(
        matches.every(
          result =>
            result.length === 1 &&
            result[0]?.code === rule.code &&
            result[0]?.names[0] === rule.name
        )
      ).toBe(true);
    }
  });

  it("does not apply an exact-cell override to changed text or a different room", () => {
    const sarah = manualStaffOverrides.overrides[0]!;
    const location = {
      roomNumber: sarah.room,
      week: sarah.week,
      day: sarah.day,
    };
    expect(
      staffForCodes(
        null,
        `${sarah.occupant} `,
        sarah.period as PeriodId,
        location
      )
    ).toEqual([]);
    expect(
      staffForCodes(null, sarah.occupant, sarah.period as PeriodId, {
        ...location,
        roomNumber: "A204",
      })
    ).toEqual([]);
  });
});

it("applies Teresa Au Yeung's exact Chinese cells", () => {
  expect(resolveCell("B307", "A", "Tuesday", "lesson6")).toEqual([
    { code: "TAY", names: ["Pui Sze Teresa Au Yeung"] },
  ]);
  expect(resolveCell("B307", "B", "Tuesday", "lesson3")).toEqual([
    { code: "TAY", names: ["Pui Sze Teresa Au Yeung"] },
  ]);
});

it("applies the latest Daniel and multi-name preferences", () => {
  expect(resolveCell("B501", "A", "Monday", "lesson2")).toEqual([
    { code: "DN", names: ["Daniel Owusu Nyantakyi"] },
  ]);
  expect(resolveCell("B604", "B", "Tuesday", "lesson2")).toEqual([
    { code: "DN", names: ["Daniel Owusu Nyantakyi"] },
  ]);
  expect(names("GP", "10I E1 G P", "lesson1")).toEqual(["Paul Gillespie"]);
  expect(names("EL", "12 EL LS L2 EL", "lesson1")).toEqual(["Eric Layman"]);
  expect(names("JJ,SL", "13 BIO SL JJ 3 13 BIO HL JJ 3", "lesson1")).toEqual([
    "Jacinta Lauren James",
  ]);
  expect(names("LK,SL", "12 HIS LK SL", "lesson1")).toEqual(["Kelsey Lowe"]);
  expect(names("MMC,LS", "12 CL LS L5 M M C", "lesson1")).toEqual([
    "Margaret Chou",
  ]);
  expect(names("AS,KW", "12 MA AS L4 K W", "lesson1")).toEqual([
    "Wesley Koekemoer",
  ]);
});

it("selects BD by the confirmed source-pattern rules", () => {
  expect(names("BD", "09F S3 B D", "lesson1")).toEqual([
    "Brendan Dunstan-Smith",
  ]);
  expect(names("BD", "08L S5 B D", "lesson7")).toEqual([
    "Deeksha Gokool Bhakarreea",
  ]);
  expect(names("BD", "Uni cor n1 B D", "mentor")).toEqual([
    "Brendan Dunstan-Smith",
  ]);
  expect(names("BD", "09L S7 B D", "lesson7")).toEqual([
    "Brendan Dunstan-Smith",
  ]);
});

it("applies the latest PHI and Year 12 ES rules", () => {
  expect(names("BL,LS", "13 PHI LH BL L1 13 PHI LS BL L1", "lesson1")).toEqual([
    "Brian Liu",
  ]);
  expect(staffForCodes("SH,SV,CC", "12 ES SH L3 S V / C C", "lesson1")).toEqual(
    [
      { code: "SV", names: ["Stephanie Visser"] },
      { code: "CC", names: ["Curtis Chung"] },
    ]
  );
});
