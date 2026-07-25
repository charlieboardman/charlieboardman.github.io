# Dance Atlas

Dance Atlas is a completely static website plus an optional map-tile workshop, all
in this one directory.

- [`content/atlas.xlsx`](content/atlas.xlsx) is the canonical database.
- The browser reads that workbook directly on every page load. Interactive content
  changes need no build step and no GitHub Action.
- The same workbook supplies all populated-place labels to the map builder.
- [`assets/map/`](assets/map/) contains the prebuilt English and Greek map tiles
  served by the static site.

The published app is:
<https://charlieboardman.github.io/greece-dance/>

## Editing content

Open `content/atlas.xlsx` in Excel, LibreOffice, Google Sheets or another
spreadsheet editor. Commit the saved file and refresh the site. The `has_dance`
column explicitly decides whether a place gets an interactive dot and archive
entry; every place is available to the map builder.

The complete workbook schema and editing guide are in
[`content/README.md`](content/README.md).

## Previewing locally

Requirements: Node.js 20 or newer and npm.

```bash
npm install
npm run dev
```

Then open <http://localhost:8000/>. A local web server is required because browsers
do not allow the page to `fetch()` its workbook from a `file:` URL.

## Rebuilding the map

This is only necessary after changing names, coordinates, `kind`, `min_zoom`, or
`priority` and wanting those edits baked into the background map.

```bash
npm install
npm run fetch:map-data
npm run build
```

`fetch:map-data` downloads Natural Earth country, province and lake geometry into
the ignored `map-source/data/` cache. Existing files are reused. `npm run build`
reads `content/atlas.xlsx` and replaces `assets/map/` in place, so the static site
immediately uses the result. Review the changes, then commit and push this
repository normally.

To deliberately refresh the Natural Earth downloads:

```bash
npm run fetch:map-data -- --force
```

There is no GitHub Action or deployment build. GitHub Pages serves the committed
HTML, JavaScript, workbook and tiles exactly as they are.

## Project structure

```text
index.html                  Static application
app.js                      Browser UI and map
atlas-workbook.js           Shared XLSX validation and hierarchy parser
content/atlas.xlsx          Canonical database
content/README.md           Spreadsheet editing guide
assets/map/                 Committed prebuilt map tiles
map-source/data/            Ignored Natural Earth download cache
scripts/fetch-map-data.mjs  Geometry downloader
scripts/build-map.mjs       Workbook-to-map renderer
tests/                      Workbook/parser tests
vendor/                     Browser copies of Marked and SheetJS
```

Natural Earth geometry is public domain. SheetJS reads the workbook and Marked
renders Markdown from the optional `info` cells; their licenses are included in
`vendor/`.
