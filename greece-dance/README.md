# Dance Atlas

Dance Atlas is a completely static website plus an optional map-tile workshop,
all in this one directory.

- [`content/dances.md`](content/dances.md) is the canonical content source.
- The browser reads and validates that file directly on every page load. Content
  changes need no build step and no GitHub Action.
- The browser renders localized village labels from the Markdown as an
  interactive map overlay.
- [`assets/map/`](assets/map/) contains the prebuilt, geometry-only map tiles
  served by the static site.

The published app is:
<https://charlieboardman.github.io/greece-dance/>

## Editing content

Edit `content/dances.md`, commit it and refresh the site. Regions and villages
use English Markdown headings plus Greek names and other fields beneath them.
The complete format and editing guide are in
[`content/README.md`](content/README.md).

## Previewing locally

Requirements: Node.js 20 or newer and npm.

```bash
npm install
npm run dev
```

Then open <http://localhost:8000/>. A local web server is required because
browsers do not allow the page to `fetch()` its content from a `file:` URL.

## Rebuilding the map

This is only necessary after changing the map geometry source or rendering
style. Content edits never require a tile rebuild.

```bash
npm install
npm run fetch:map-data
npm run build
```

`fetch:map-data` downloads Natural Earth country, province and lake geometry
into the ignored `map-source/data/` cache. Existing files are reused. `npm run
build` replaces `assets/map/` with geometry-only tiles. Review the changes, then
commit and push this repository normally.

To deliberately refresh the Natural Earth downloads:

```bash
npm run fetch:map-data -- --force
```

There is no GitHub Action or deployment build. GitHub Pages serves the committed
HTML, JavaScript, Markdown and tiles exactly as they are.

## Project structure

```text
index.html                  Static application
app.js                      Browser UI and map
dances-markdown.js          dances.md validation and hierarchy parser
region-presentation.js      Localized names and region sorting
content/dances.md           Canonical content source
content/README.md           Markdown editing guide
assets/map/                 Committed prebuilt map tiles
map-source/data/            Ignored Natural Earth download cache
scripts/fetch-map-data.mjs  Geometry downloader
scripts/build-map.mjs       Geometry-only map renderer
tests/                      Content/parser tests
vendor/                     Browser copy of Marked
```

Natural Earth geometry is public domain. Marked renders village information
sections; its license is included in `vendor/`.
