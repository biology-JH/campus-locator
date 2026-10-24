const EXCLUDED_TEACHER_CODES = new Set(["GM", "YS", "RK"]);

// These canonical source spellings correspond to the removal names requested in the UI.
const EXCLUDED_TEACHER_NAMES = new Set([
  "greg morrison",
  "gregg morrison",
  "sam sze yin hung",
  "sze yin hung",
  "yin hung sze",
  "robert kitney",
  "robert kitley",
]);

/** Capitalizes the first Unicode letter within each parenthetical segment. */
export function capitalizeBracketedNames(value: string): string;
export function capitalizeBracketedNames(value: null): null;
export function capitalizeBracketedNames(value: undefined): undefined;
export function capitalizeBracketedNames(value: string | null | undefined): string | null | undefined;
export function capitalizeBracketedNames(value: string | null | undefined): string | null | undefined {
  if (value === null || value === undefined) return value;
  return value.replace(/\(([^()]*)\)/gu, (_match, contents: string) =>
    `(${contents.replace(/\p{L}/u, letter => letter.toUpperCase())})`
  );
}

function teacherNameKey(value: string): string {
  return capitalizeBracketedNames(value)
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();
}

export function isExcludedTeacherName(name: string): boolean {
  return EXCLUDED_TEACHER_NAMES.has(teacherNameKey(name));
}

export function isExcludedTeacherCode(code: string): boolean {
  return EXCLUDED_TEACHER_CODES.has(code.trim().toUpperCase());
}
