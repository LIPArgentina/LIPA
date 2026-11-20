# TV compatibility build

The two TV entry pages use local ES5 assets; no runtime CDN or Babel is needed.
Edit config.js, visor-session.js, grilla-engine.js or pantalla-tv.js and rebuild the
TV bundle whenever their behavior changes. The build substitutes only the TV
copy of visor-session's AbortSignal timeout.

Build: `node tools/build-tv.cjs <path-to-babel-standalone.cjs>`
Compiler: @babel/standalone 7.28.5, env preset targeting IE 11 syntax.
Vendored runtime: core-js-bundle 3.47.0 and whatwg-fetch 3.6.20 (licenses alongside).

tv-compat.js supplies DOM methods and optional abort support. TV layout uses
explicit positions instead of CSS Grid. Refresh has a bounded timeout even when
AbortController is absent. Changes do not alter tournament data or scoring.

Compatibility validation: parse shipped JS as ES5; render both categories with
Promise, Map, fetch, ResizeObserver, AbortController, Array.at and DOM append /
replaceChildren removed before bootstrap. Verify 12 overview groups, two knockout
boards and 10-second group rotation. A desktop simulation is not a physical
Samsung test; old TLS/certificate support cannot be repaired by page JavaScript.
