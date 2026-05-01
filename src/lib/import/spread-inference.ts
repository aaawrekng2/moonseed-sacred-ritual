/**
 * CSV import — spread inference (CS).
 *
 * Maps a row's filled-card count to a Moonseed `spread_type`.
 * Lossy fallbacks return `fits=false` and ask the caller to append
 * cards 4..N to the imported reading's note field so no card is lost.
 */

export type InferredSpread = {
  spread_type: "single" | "three" | "celtic";
  fits: boolean;
  excessCardsBehavior?: "append-to-notes";
};

export function inferSpread(filledCardCount: number): InferredSpread {
  if (filledCardCount <= 0) {
    return { spread_type: "single", fits: false };
  }
  if (filledCardCount === 1) return { spread_type: "single", fits: true };
  if (filledCardCount === 2) return { spread_type: "three", fits: false };
  if (filledCardCount === 3) return { spread_type: "three", fits: true };
  if (filledCardCount >= 4 && filledCardCount <= 9) {
    return {
      spread_type: "three",
      fits: false,
      excessCardsBehavior: "append-to-notes",
    };
  }
  if (filledCardCount === 10) return { spread_type: "celtic", fits: true };
  return {
    spread_type: "celtic",
    fits: false,
    excessCardsBehavior: "append-to-notes",
  };
}