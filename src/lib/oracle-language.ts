/**
 * Oracle/Plain language lookup. Every user-facing label that has a poetic
 * "Oracle" voice and a stripped-down "Plain" voice lives here so the
 * rest of the app stays a single render path. Use the `t()` helper
 * paired with `useOracleMode()` to swap text inline.
 */
export const LANG = {
  // Settings → Themes
  themes:              { plain: "Themes",           oracle: "The Atmosphere" },
  cardBack:            { plain: "Card Back",        oracle: "The Veil" },
  yourSignature:       { plain: "Custom Accent Color", oracle: "Your Signature" },
  backgroundGradient:  { plain: "Background",       oracle: "The Horizon" },
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
  eraseTheme:          { plain: "Erase",            oracle: "Release This Sanctuary" },
  savedThemes:         { plain: "Saved Themes",     oracle: "Your Sanctuaries" },
  communityThemes:     { plain: "Community Themes", oracle: "Celestial Palettes" },
  swipeToExplore:      { plain: "Swipe to explore", oracle: "Swipe to explore" },
  yourIcon:            { plain: "Your Icon",        oracle: "Your Sigil" },
  // Settings → Profile
  displayName:         { plain: "Display Name",     oracle: "Your Name in the Circle" },
  intention:           { plain: "Your Intention",   oracle: "Your Intention" },
  updateIntention:     { plain: "Update Intention", oracle: "Recast Your Intention" },
  saveProfile:         { plain: "Save Profile",     oracle: "Seal Your Profile" },
  // Settings → Blueprint
  blueprint:           { plain: "Blueprint",        oracle: "Cosmic Blueprint" },
  dateOfBirth:         { plain: "Date of Birth",    oracle: "The Day You Arrived" },
  timeOfBirth:         { plain: "Time of Birth",    oracle: "The Hour You Arrived" },
  placeOfBirth:        { plain: "Place of Birth",   oracle: "Where You Were Grounded" },
  saveBlueprint:       { plain: "Save Blueprint",   oracle: "Seal Your Blueprint" },
  // Settings → Preferences
  defaultSpread:       { plain: "Default Spread",   oracle: "Your Opening Spread" },
  moonFeatures:        { plain: "Moon Features",    oracle: "Lunar Awareness" },
  // Draw screen
  drawWhisper:         { plain: "Draw",             oracle: "Draw" },
  // General
  settings:            { plain: "Settings",         oracle: "The Inner Sanctum" },
  profile:             { plain: "Profile",          oracle: "The Seeker" },
  preferences:         { plain: "Preferences",      oracle: "The Way" },
  data:                { plain: "Data",             oracle: "The Archive" },
} as const;

export type LangKey = keyof typeof LANG;

export function t(key: LangKey, isOracle: boolean): string {
  return isOracle ? LANG[key].oracle : LANG[key].plain;
}