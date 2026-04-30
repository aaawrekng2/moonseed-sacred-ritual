/**
 * Oracle/Plain language lookup. Every user-facing label that has a poetic
 * "Oracle" voice and a stripped-down "Plain" voice lives here so the
 * rest of the app stays a single render path. Use the `t()` helper
 * paired with `useOracleMode()` to swap text inline.
 */
export const LANG = {
  // Settings → Themes
  themes:              { plain: "Theme",            oracle: "The Atmosphere" },
  cardBack:            { plain: "Card Back",        oracle: "The Veil" },
  yourSignature:       { plain: "Accent Color",     oracle: "Your Signature" },
  backgroundGradient:  { plain: "Colors & Background", oracle: "The Horizon" },
  leftColor:           { plain: "Left Color",       oracle: "The Past" },
  rightColor:          { plain: "Right Color",      oracle: "The Future" },
  headingFont:         { plain: "Heading Font",     oracle: "The Voice" },
  headingSize:         { plain: "Heading Size",     oracle: "The Weight" },
  interfaceFade:       { plain: "Interface Fade",   oracle: "The Veil Opacity" },
  restingOpacity:      { plain: "Resting Opacity",  oracle: "At Rest" },
  subtle:              { plain: "Subtle",           oracle: "Whisper" },
  bold:                { plain: "Bold",             oracle: "Speak" },
  resetDefault:        { plain: "Reset to Default", oracle: "Return to Silence" },
  saveTheme:           { plain: "Save Theme",       oracle: "Preserve This Moment" },
  loadTheme:           { plain: "Load",             oracle: "Return Here" },
  overwriteTheme:      { plain: "Overwrite",        oracle: "Overwrite This Sanctuary" },
  eraseTheme:          { plain: "Delete",           oracle: "Release This Sanctuary" },
  savedThemes:         { plain: "Your Saved Themes", oracle: "Your Sanctuaries" },
  communityThemes:     { plain: "Themes",           oracle: "Celestial Palettes" },
  swipeToExplore:      { plain: "Swipe to explore", oracle: "Swipe to explore" },
  yourIcon:            { plain: "Your Icon",        oracle: "Your Sigil" },
  // Settings → Profile
  displayName:         { plain: "Display Name",     oracle: "Your Name in the Circle" },
  intention:           { plain: "Your Intention",   oracle: "Your Intention" },
  updateIntention:     { plain: "Update Intention", oracle: "Recast Your Intention" },
  saveProfile:         { plain: "Save Profile",     oracle: "Seal Your Profile" },
  // Settings → Blueprint
  blueprint:           { plain: "Astrology Profile", oracle: "Cosmic Blueprint" },
  dateOfBirth:         { plain: "Date of Birth",    oracle: "The Day You Arrived" },
  timeOfBirth:         { plain: "Time of Birth",    oracle: "The Hour You Arrived" },
  placeOfBirth:        { plain: "Place of Birth",   oracle: "Where You Were Grounded" },
  saveBlueprint:       { plain: "Save Astrology Profile", oracle: "Seal Your Blueprint" },
  // Settings → Preferences
  defaultSpread:       { plain: "Default Spread",   oracle: "Your Opening Spread" },
  moonFeatures:        { plain: "Moon Phase Display", oracle: "Lunar Awareness" },
  // Draw screen
  drawWhisper:         { plain: "Draw",             oracle: "Draw" },
  // Tabletop confirmations
  beginAgainTitle:     { plain: "Begin again?",          oracle: "Clear the altar?" },
  beginAgainBody:      { plain: "Your picks will return to the table.", oracle: "Your picks will return to the table." },
  beginAgainConfirm:   { plain: "Begin again",           oracle: "Begin again" },
  leaveReadingTitle:   { plain: "Leave this reading?",   oracle: "Leave the altar?" },
  leaveReadingBody:    { plain: "Your selections will be lost.", oracle: "Your selections will dissolve." },
  leaveReadingConfirm: { plain: "Leave",                 oracle: "Leave the altar" },
  cancel:              { plain: "Cancel",                oracle: "Stay" },
  // General
  settings:            { plain: "Settings",         oracle: "The Inner Sanctum" },
  profile:             { plain: "Profile",          oracle: "The Seeker" },
  preferences:         { plain: "Preferences",      oracle: "The Way" },
  data:                { plain: "Data",             oracle: "The Archive" },
  // Tabletop "Clarity" UI density levels
  clarity:             { plain: "Clarity",          oracle: "The Clarity" },
  claritySeen:         { plain: "Seen",             oracle: "Seen" },
  clarityGlimpse:      { plain: "Glimpse",          oracle: "Glimpse" },
  clarityVeiled:       { plain: "Veiled",           oracle: "Veiled" },
} as const;

export type LangKey = keyof typeof LANG;

export function t(key: LangKey, isOracle: boolean): string {
  return isOracle ? LANG[key].oracle : LANG[key].plain;
}