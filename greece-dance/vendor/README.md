# Vendored browser libraries

These browser-ready files are committed so the application does not depend on a
third-party JavaScript CDN at runtime:

- MapLibre GL JS 6.0.0 (`maplibre-gl*.mjs` and `maplibre-gl.css`)
- Marked 18.0.7 (`marked.umd.js`)
- DOMPurify 3.4.12 (`purify.min.js`)

The corresponding license texts are in this directory. When updating a library,
replace its distributed files and license together, then verify the application
in a browser before committing.
