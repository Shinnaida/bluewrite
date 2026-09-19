// BlueWrite — Phase 6 Stage 5 (Track A, decisions D3/D4/D9): the client's
// LANGUAGE REGISTRY.
//
// The registry lives in ONE place on the server — resources/ai/language_registry.json
// — and reaches the client on the two bootstrap reads (`POST /login` and
// `GET /me`). This module holds the copy the UI reads, so no component and no
// other lib carries a language list of its own. Adding a language is a data
// change on the server; the client picks it up on the next sign-in.
//
// It is a small MUTABLE holder on purpose. The alternative — a bundled constant
// — is exactly the hard-coded list this track removes: it would go stale the
// moment the owner adds a language, and worse, it would let the UI offer a code
// the server does not know. An empty registry is therefore the honest state
// before the bootstrap lands: a selector with nothing in it beats one offering
// a language the server will reject.
//
// The evidence fields are NOT here and must not be: the server does not send
// them, because the UI has no use for them and an approval must never be shown
// as if it were a quality claim.

/** The active registry, in the server's order. Empty until the bootstrap lands. */
let active = [];

/**
 * Install the registry from a bootstrap read. Called once from the login/me
 * handlers; safe to call again (a reconnect re-reads it).
 *
 * @param {unknown} languages the `languages` array from POST /login or GET /me
 */
export function setLanguageRegistry(languages) {
  active = Array.isArray(languages)
    ? languages.filter((l) => l && typeof l.code === 'string' && l.code !== '')
    : [];
}

/** The active registry (read-only use; do not mutate the returned array). */
export function getLanguageRegistry() {
  return active;
}

/** One entry, or null. */
export function findLanguage(code) {
  return active.find((l) => l.code === code) ?? null;
}

/** Every known code, in the server's order. */
export function registryCodes() {
  return active.map((l) => l.code);
}

/** The codes the bilingual terminology table may carry (glossary_supported). */
export function glossaryCodes() {
  return active.filter((l) => l.glossary_supported).map((l) => l.code);
}

/**
 * May AI GENERATE translate a source in this language? The server enforces
 * this; the UI only uses it to hide a control whose only answer would be no.
 */
export function translationEnabled(code) {
  return !!findLanguage(code)?.translation_enabled;
}

/**
 * The approved officer-facing message for a language that cannot be translated
 * yet (D4, wording fixed at G2): what DID happen first, then what will not.
 * Mirrors NarrativeService::translationLanguageReason(). Kept here so the
 * editor and the AI panel cannot phrase it two ways.
 */
export function translationDisabledNotice() {
  return "Saved as written. AI translation isn't available for this language yet.";
}
