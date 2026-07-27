# Dance Atlas

Dance Atlas is a completely static website. The repository contains the whole
application and requires no build or deployment service.

- [`content/dances.md`](content/dances.md) is the canonical content source.
- The browser reads and validates that file directly on every page load. Content
  changes need no build step and no GitHub Action.
- The browser renders localized village labels from the Markdown as an
  interactive map overlay.
- The map reads OpenStreetMap Shortbread vector tiles at runtime and renders
  land, water, administrative boundaries and country names. It deliberately
  omits provider city and village labels so the atlas labels remain prominent.

The published app is:
<https://charlieboardman.github.io/greece-dance/>

## Editing content

Edit [`content/dances.md` on GitHub](https://github.com/charlieboardman/charlieboardman.github.io/edit/main/greece-dance/content/dances.md),
commit it and refresh the site. Regions and villages use English Markdown
headings plus Greek names and other fields beneath them. The complete format
and editing guide are in [`content/README.md`](content/README.md).

## Previewing locally

Requirements: Python 3 for the local web server, plus Node.js 20 or newer and
npm for the test command and npm shortcuts.

```bash
npm run dev
```

Then open <http://localhost:8000/>. A local web server is required because
browsers do not allow the page to `fetch()` its content from a `file:` URL.

## Testing

The tests validate the content grammar and presentation helpers without
freezing the current number of regions or villages:

```bash
npm test
```

There is no GitHub Action or deployment build. GitHub Pages serves the committed
HTML, JavaScript and Markdown exactly as they are. Map geography updates from
OpenStreetMap at runtime.

## Project structure

```text
index.html                  Static application
app.js                      Browser UI and map
dances-markdown.js          dances.md validation and hierarchy parser
region-presentation.js      Localized names and region sorting
content/dances.md           Canonical content source
content/README.md           Markdown editing guide
tests/                      Content/parser tests
vendor/                     Browser libraries and their licenses
```

OpenStreetMap supplies the live vector tiles and is credited in the map.
MapLibre renders the basemap, Marked renders village information sections, and
DOMPurify sanitizes the resulting HTML. Their licenses are included in
`vendor/`.
