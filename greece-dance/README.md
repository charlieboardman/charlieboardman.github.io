# Dance Atlas

Dance Atlas is a completely static website. The repository contains the whole
application and requires no build or deployment service.

- [`content/dances.md`](content/dances.md) is the canonical content source.
- The browser reads and validates that file directly on every page load. Content
  changes need no build step and no GitHub Action.
- The browser renders localized village labels from the Markdown as an
  interactive map overlay.
- The map renders a committed 3 arc-second SRTM land-relief tile archive with
  Natural Earth lakes and rivers. It needs no live map-tile service.

The published app is:
<https://charlieboardman.github.io/greece-dance/>

## Editing content

Edit [`content/dances.md` on GitHub](https://github.com/charlieboardman/charlieboardman.github.io/edit/main/greece-dance/content/dances.md),
commit it and refresh the site. Regions and villages use English Markdown
headings plus Greek names and other fields beneath them. The complete format
and editing guide are in [`content/README.md`](content/README.md).

## Previewing locally

Requirements: Python 3 for the included byte-range-capable local web server,
plus Node.js 20 or newer and npm for the test command and npm shortcuts.

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
HTML, JavaScript, Markdown and map textures exactly as they are.

## Region color palette

Region colors are a fixed categorical palette selected with a Glasbey-style
maximin process. Candidate colors are sampled in OKLCH, which makes geometric
distance correspond much more closely to perceived difference than RGB or HSL.
Candidates must:

- fit inside the sRGB gamut;
- have OKLCH lightness from 0.56 to 0.76 and chroma from 0.13 to 0.28, keeping
  them bright and vivid;
- maintain at least 3.5:1 contrast against the map's neutral black dots and
  2.15:1 against the original pale `#edf2ec` land color used when the palette
  was generated.

A multi-start farthest-point search chooses the candidate whose nearest
existing palette color is farthest away in OKLab at each step. The resulting
colors are converted to hex and stored explicitly in
[`content/dances.md`](content/dances.md), so a region never changes color just
because content was added or reordered. The current colors were assigned to
minimize their total perceptual shift from the previous palette.

When adding a region, retain all existing assignments and choose the valid
candidate with the greatest minimum OKLab distance from the colors already in
use. Do not regenerate the whole palette: stable region identity is more
valuable than a small global improvement after each edit.

## Project structure

```text
index.html                  Static application
app.js                      Browser UI and map
dances-markdown.js          dances.md validation and hierarchy parser
region-presentation.js      Localized names and region sorting
content/dances.md           Canonical content source
content/README.md           Markdown editing guide
assets/basemaps/            Static map textures and source notes
scripts/                    One-off basemap preparation tool
tests/                      Content/parser tests
vendor/                     Browser libraries and their licenses
```

NASA SRTM and Natural Earth supply the public-domain basemap data. MapLibre
renders it through the bundled PMTiles reader, Marked renders village
information sections, and DOMPurify sanitizes the resulting HTML. Library
licenses are included in `vendor/`.
