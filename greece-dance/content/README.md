# Editing `atlas.md`

[`atlas.md`](atlas.md) is the complete, canonical archive. The page fetches it and
builds the map markers and archive tree in your browser every time the page loads.
Save or commit an edit, reload the site, and the edit appears—there is no build step
and no generated index to keep in sync.

The file controls the interactive **overlay layer**. It does not control names baked
into the raster map; those live separately in `map-layer/places.csv`.

## The shape of the file

The heading level is the hierarchy. The word after the heading markers removes any
ambiguity:

```markdown
atlas-version: 1

# Region: Macedonia
color: #e5a83f
bounds: 39.8, 20.8, 41.4, 24.8

## Village: Thessaloniki
coordinates: 40.6401, 22.9444

This village belongs directly to Macedonia.

## Subregion: Pella

### Village: Aridaia
coordinates: 40.973, 22.057

This village belongs to Pella, inside Macedonia.
```

- `# Region:` starts a region.
- `## Village:` adds a village directly to the current region.
- `## Subregion:` starts a subregion.
- `### Village:` adds a village to the current subregion.
- `####`, `#####` and `######` are available as ordinary headings inside village
  text. Levels 1–3 are reserved for the archive structure.

Indentation and extra spaces do not matter on headings or setting lines. Both `:`
and `=` work for settings, though the examples use `:` consistently.

## Region settings

Put these two lines directly below every region heading:

```markdown
color: #3f77a6
bounds: 35.0, 23.4, 40.5, 29.0
```

`color` is a six-digit hex color. `bounds` is four comma-separated numbers in this
order: **south, west, north, east**. The bounds determine the map view when someone
selects the region.

## Village content

The first meaningful line below every village heading is its coordinates:

```markdown
coordinates: 38.227, 25.994
```

The order is **north, east** (latitude, longitude). Everything after that, until the
next structural heading, is the village's Markdown. Paragraphs, emphasis, lists,
links, blockquotes, code and level 4–6 headings are supported. Images and raw HTML
are displayed as text so archive entries remain text-only.

Search checks the region, optional subregion, village name and all village Markdown.
Names are written exactly once—in their headings—and stable internal IDs are derived
from the hierarchy, such as `macedonia/pella/aridaia`.

## Errors are meant to be fixable

If the file is malformed, the archive panel shows the exact line number, the source
line and a plain-language explanation. For example, it catches missing settings,
invalid coordinates, duplicate names, an unsupported heading level and a village at
the wrong depth. Fix the named line and reload; no command is required.

Keep `atlas-version: 1` as the first non-empty line. It gives future versions of the
reader a safe way to recognize this format instead of guessing.
