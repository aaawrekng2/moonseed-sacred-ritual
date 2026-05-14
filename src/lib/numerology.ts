/**
 * Q51a — Numerology calculation library.
 *
 * Pythagorean numerology system. All functions are pure.
 * Master numbers (11, 22, 33) are preserved EXCEPT for Personal
 * Year/Month/Day which always reduce to a single digit (per the
 * Decoz / Spiral Sea convention).
 */

export type Numerogram = {
  digit: number; // 1-9 (or master if preserved)
  master: 11 | 22 | 33 | null;
};

export function reduceToDigit(n: number, preserveMaster = true): Numerogram {
  let value = Math.abs(n);
  while (value > 9) {
    if (preserveMaster && (value === 11 || value === 22 || value === 33)) {
      return { digit: value, master: value as 11 | 22 | 33 };
    }
    value = String(value)
      .split("")
      .reduce((s, c) => s + Number(c), 0);
  }
  return { digit: value, master: null };
}

// Pythagorean letter-to-number map (A=1, B=2, ..., I=9, J=1, ...)
const LETTER_VALUES: Record<string, number> = {};
"ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").forEach((c, i) => {
  LETTER_VALUES[c] = (i % 9) + 1;
});

const VOWELS = new Set(["A", "E", "I", "O", "U"]);

function letterValue(c: string): number {
  return LETTER_VALUES[c.toUpperCase()] ?? 0;
}

export function sumLetters(name: string, predicate: (c: string) => boolean): number {
  let total = 0;
  for (const ch of name) {
    const upper = ch.toUpperCase();
    if (upper >= "A" && upper <= "Z" && predicate(upper)) {
      total += letterValue(upper);
    }
  }
  return total;
}

// ===== Date-based =====

export function lifePath(birthDate: string): Numerogram {
  const digits = birthDate.replace(/-/g, "").split("").map(Number);
  return reduceToDigit(digits.reduce((s, d) => s + d, 0));
}

export function birthdayNumber(birthDate: string): Numerogram {
  const day = Number(birthDate.split("-")[2]);
  return reduceToDigit(day);
}

export function personalYear(birthDate: string, year: number): Numerogram {
  const [, monthStr, dayStr] = birthDate.split("-");
  const month = Number(monthStr);
  const day = Number(dayStr);
  const yearDigits = String(year)
    .split("")
    .reduce((s, c) => s + Number(c), 0);
  return reduceToDigit(month + day + yearDigits, false);
}

export function personalMonth(
  birthDate: string,
  year: number,
  month: number,
): Numerogram {
  const py = personalYear(birthDate, year).digit;
  return reduceToDigit(py + month, false);
}

export function personalDay(
  birthDate: string,
  year: number,
  month: number,
  day: number,
): Numerogram {
  const pm = personalMonth(birthDate, year, month).digit;
  return reduceToDigit(pm + day, false);
}

// ===== Birth Cards (Major Arcana from birth date sum) =====

export type BirthCards = {
  primary: number; // Major Arcana 1-21 (the larger of the two)
  secondary: number | null; // Single digit 1-9, or null if same as primary
  third: number | null;
};

export function birthCards(birthDate: string): BirthCards {
  const digits = birthDate.replace(/-/g, "").split("").map(Number);
  let sum = digits.reduce((s, d) => s + d, 0);
  const seen: number[] = [];
  while (sum > 21) {
    seen.push(sum);
    sum = String(sum)
      .split("")
      .reduce((s, c) => s + Number(c), 0);
  }
  const primary = sum;
  let secondary: number | null = null;
  if (primary > 9) {
    let s = primary;
    while (s > 9) {
      s = String(s).split("").reduce((acc, c) => acc + Number(c), 0);
    }
    secondary = s;
  }
  const third = seen.includes(19) ? 10 : null;
  return { primary, secondary, third };
}

// ===== Name-based =====

export function expressionNumber(birthName: string): Numerogram {
  return reduceToDigit(sumLetters(birthName, () => true));
}

export function soulUrgeNumber(birthName: string): Numerogram {
  return reduceToDigit(sumLetters(birthName, (c) => VOWELS.has(c)));
}

export function personalityNumber(birthName: string): Numerogram {
  return reduceToDigit(sumLetters(birthName, (c) => !VOWELS.has(c)));
}

// ===== Number → Major Arcana mapping =====

export function numberToMajorArcana(n: number): number | null {
  if (n >= 1 && n <= 21) return n;
  if (n === 22) return 0; // The Fool wraps
  return null;
}

// ===== Q52b — Karmic Debt, Lessons, Hidden Passion, Cornerstone/Capstone, Maturity =====

export type KarmicDebt = {
  number: 13 | 14 | 16 | 19;
  source: "lifePath" | "expression" | "soulUrge" | "personality" | "birthday";
};

const KARMIC_SET = new Set([13, 14, 16, 19]);

function traceForKarmic(start: number): 13 | 14 | 16 | 19 | null {
  let v = start;
  while (v > 9 && v !== 11 && v !== 22 && v !== 33) {
    if (KARMIC_SET.has(v)) return v as 13 | 14 | 16 | 19;
    v = String(v).split("").reduce((s, c) => s + Number(c), 0);
  }
  return null;
}

export function detectKarmicDebt(
  birthDate: string,
  birthName: string | null,
): KarmicDebt[] {
  const debts: KarmicDebt[] = [];

  const digits = birthDate.replace(/-/g, "").split("").map(Number);
  const lpSum = digits.reduce((s, d) => s + d, 0);
  const lpKarmic = traceForKarmic(lpSum);
  if (lpKarmic) debts.push({ number: lpKarmic, source: "lifePath" });

  const day = Number(birthDate.split("-")[2]);
  if (KARMIC_SET.has(day)) {
    debts.push({ number: day as 13 | 14 | 16 | 19, source: "birthday" });
  }

  if (birthName && birthName.trim().length > 0) {
    const VOWELS_LOCAL = new Set(["A", "E", "I", "O", "U"]);
    const checks: Array<[number, KarmicDebt["source"]]> = [
      [sumLetters(birthName, () => true), "expression"],
      [sumLetters(birthName, (c) => VOWELS_LOCAL.has(c)), "soulUrge"],
      [sumLetters(birthName, (c) => !VOWELS_LOCAL.has(c)), "personality"],
    ];
    for (const [sum, source] of checks) {
      const k = traceForKarmic(sum);
      if (k) debts.push({ number: k, source });
    }
  }

  return debts;
}

export function karmicLessons(birthName: string): number[] {
  const present = new Set<number>();
  for (const ch of birthName.toUpperCase()) {
    if (ch >= "A" && ch <= "Z") {
      present.add(((ch.charCodeAt(0) - 65) % 9) + 1);
    }
  }
  const lessons: number[] = [];
  for (let n = 1; n <= 9; n++) {
    if (!present.has(n)) lessons.push(n);
  }
  return lessons;
}

export function hiddenPassion(birthName: string): Numerogram {
  const counts: Record<number, number> = {};
  for (const ch of birthName.toUpperCase()) {
    if (ch >= "A" && ch <= "Z") {
      const n = ((ch.charCodeAt(0) - 65) % 9) + 1;
      counts[n] = (counts[n] ?? 0) + 1;
    }
  }
  let topNum = 1;
  let topCount = -1;
  for (let n = 1; n <= 9; n++) {
    if ((counts[n] ?? 0) > topCount) {
      topNum = n;
      topCount = counts[n] ?? 0;
    }
  }
  return { digit: topNum, master: null };
}

export function cornerstone(
  birthName: string,
): { letter: string; value: Numerogram } | null {
  const first = birthName.trim().split(/\s+/)[0]?.toUpperCase() ?? "";
  if (!first) return null;
  const letter = first[0];
  if (!/[A-Z]/.test(letter)) return null;
  return {
    letter,
    value: { digit: ((letter.charCodeAt(0) - 65) % 9) + 1, master: null },
  };
}

export function capstone(
  birthName: string,
): { letter: string; value: Numerogram } | null {
  const first = birthName.trim().split(/\s+/)[0]?.toUpperCase() ?? "";
  if (!first) return null;
  const letter = first[first.length - 1];
  if (!/[A-Z]/.test(letter)) return null;
  return {
    letter,
    value: { digit: ((letter.charCodeAt(0) - 65) % 9) + 1, master: null },
  };
}

export function maturityNumber(
  birthDate: string,
  birthName: string,
): Numerogram {
  const lp = lifePath(birthDate);
  const ex = expressionNumber(birthName);
  return reduceToDigit(lp.digit + ex.digit);
}