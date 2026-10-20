import subjectDictionary from "./data/subject-abbreviations.json";

type SubjectEntry = { grade: string; code: string; fullName: string };
type SubjectDictionary = {
  sourceFile: string;
  sourceSheet: string;
  byShort: Record<string, SubjectEntry>;
  byRoot: Record<string, string[]>;
  aliases: Record<string, string>;
};

const dictionary = subjectDictionary as SubjectDictionary;
const aliases = new Map(
  Object.entries(dictionary.aliases).map(([alias, fullName]) => [normalizeLetters(alias), fullName]),
);
const rootsByLength = Object.keys(dictionary.byRoot)
  .map(normalizeLetters)
  .filter(Boolean)
  .sort((left, right) => right.length - left.length);

function normalizeLetters(value: string): string {
  return value.toUpperCase().replace(/[^A-Z]/g, "");
}

function isGradeToken(token: string): boolean {
  return /^\d{2}[A-Z]?$/.test(token.toUpperCase());
}

function fullNameForRoot(root: string, grade: string): string | null {
  const exact = dictionary.byShort[`${grade}${root}`]?.fullName;
  if (exact) return exact;
  const values = dictionary.byRoot[root];
  if (values?.length === 1) return values[0] ?? null;
  return aliases.get(root) ?? null;
}

function matchSubject(tokens: string[], start: number, grade: string) {
  let best: { end: number; root: string; fullName: string } | null = null;
  let letters = "";
  for (let end = start; end < Math.min(tokens.length, start + 6); end += 1) {
    const token = tokens[end] ?? "";
    const tokenLetters = normalizeLetters(token);
    if (!tokenLetters) break;
    letters += tokenLetters;
    const candidates = rootsByLength.filter(root => root === letters);
    for (const root of candidates) {
      const fullName = fullNameForRoot(root, grade) ?? aliases.get(root);
      if (fullName) best = { end, root, fullName };
    }
    const aliasName = aliases.get(letters);
    if (aliasName) best = { end, root: letters, fullName: aliasName };
    if (rootsByLength.every(root => !root.startsWith(letters)) && ![...aliases.keys()].some(alias => alias.startsWith(letters))) break;
  }
  return best;
}

function numericSuffix(tokens: string[], start: number, end: number): string {
  const consumed = tokens.slice(start, end + 1).join("");
  return consumed.match(/\d+[A-Z]?$/)?.[0]?.replace(/[A-Z]$/i, "") ?? "";
}

/**
 * Expand a timetable course code for people reading the schedule.
 * Raw occupant text is deliberately untouched because teacher-resolution rules use it.
 */
export function formatSubjectDisplay(value: string | null): string | null {
  if (!value) return value;
  const normalizedValue = value.trim().replace(/\s+/g, " ");
  if (
    /^12 SV ES C (?:SH )?L3 C 12 SV ES C SS L3 C$/i.test(normalizedValue)
  ) {
    return "12 ESS HL and SL";
  }
  const tokens = normalizedValue.split(" ").filter(Boolean);
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const gradeMatch = tokens[index]?.match(/^(\d{2})[A-Z]?$/);
    if (!gradeMatch || !isGradeToken(tokens[index] ?? "")) continue;
    const match = matchSubject(tokens, index + 1, gradeMatch[1]);
    if (!match) continue;
    const suffix = numericSuffix(tokens, index + 1, match.end);
    const before = tokens.slice(0, index + 1);
    const after = tokens.slice(match.end + 1);
    const replacement = suffix ? `${match.fullName} ${suffix}` : match.fullName;
    return [...before, replacement, ...after].join(" ").replace(/\s+/g, " ").trim();
  }

  const normalized = normalizeLetters(value);
  const directAlias = aliases.get(normalized);
  return directAlias ?? value;
}

export const SUBJECT_DICTIONARY_SUMMARY = {
  sourceFile: dictionary.sourceFile,
  sourceSheet: dictionary.sourceSheet,
  uniqueEntries: Object.keys(dictionary.byShort).length,
  aliases: dictionary.aliases,
};
