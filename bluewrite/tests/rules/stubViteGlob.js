// BlueWrite — the stand-in for Vite's `import.meta.glob`, for the render harness.
//
// WHY THIS FILE EXISTS. `import.meta.glob` is a Vite build transform: it is not
// a function at runtime, it is replaced by the object of modules matching the
// pattern. The render harness bundles with esbuild, which does not implement it,
// so it rewrites the call to the name below and injects this module to answer it
// (see stubViteGlob in renderHarness.mjs for the whole argument).
//
// IT ANSWERS WITH AN EMPTY OBJECT, which is the state the one production caller
// is designed for: a screen looking for an OPTIONAL file finds none, and draws
// its own fallback. A stub that returned something would test the fallback away.

/** No files matched — see the note above. */
export function bwStubViteGlob() {
  return {};
}
