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

function sumLetters(name: string, predicate: (c: string) => boolean): number {
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
  primary: number; // Major Arcana index 1-21
  secondary: number; // Major Arcana index 1-9
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
  let secondary = primary;
  while (secondary > 9) {
    secondary = String(secondary)
      .split("")
      .reduce((s, c) => s + Number(c), 0);
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