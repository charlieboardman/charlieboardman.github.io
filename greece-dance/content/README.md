# Content guide

This directory controls the interactive **overlay layer**: colored dots, tooltips,
the expandable region tree and village text. It does not control place names baked
into the map. Those are maintained separately in `map-layer/places.csv`.

## Folder structure

The folder structure is the archive structure. Region, subregion and village names
are generated from their directory names, with hyphens converted to spaces and each
word capitalized.

```text
content/regions/
  aegean/
    region.json
    chios/
      pyrgi/
        info.md
        coordinates.json
```

That example renders as **Aegean → Chios → Pyrgi**. Villages that do not belong to
a subregion can instead live directly inside their region:

```text
content/regions/
  aegean/
    region.json
    pyrgi/
      info.md
      coordinates.json
```

That example renders as **Aegean → Pyrgi**. A region may contain direct villages,
subregions or both. Use lowercase directory names and hyphens between words, such
as `western-macedonia` or `nea-vyssa`. Unicode directory names are supported when
spelling matters; `çeşme` renders as **Çeşme**.

## Region settings

Each region has one `region.json`. The region name comes from the directory, so this
file contains only its tray color and the map bounds used when focusing that region:

```json
{
  "color": "#3f77a6",
  "bounds": {
    "south": 35.0,
    "west": 23.4,
    "north": 40.5,
    "east": 29.0
  }
}
```

Subregions need no configuration file. A directory directly inside a region is
recognized as a village when it contains both village source files; otherwise it
is treated as a subregion.

## Village content

Each village is a directory inside a region or subregion and contains exactly two
source files:

- `info.md` contains the text rendered beneath the village name. Standard Markdown
  formatting such as paragraphs, headings, emphasis, lists and links is supported.
  Images and raw HTML are kept as text so village cards remain text-only.
- `coordinates.json` positions the colored dot using separately labeled north and
  east values:

```json
{
  "north": 38.227,
  "east": 25.994
}
```

The village name and internal ID come from its directory path. There are no name,
ID, summary, notes, dance, location or review fields to maintain. Search checks the
village, optional subregion and region names plus the contents of `info.md`, so
dance names written in the Markdown remain searchable.

## Rebuild

After changing the directory structure, `info.md`, `coordinates.json` or
`region.json`, regenerate the browser-ready catalog:

```bash
npm run build
```

The generated `content/catalog.generated.js` file is committed to the repository.
Adding or moving a village here does not add, remove or reposition its baked map
label; edit `map-layer/places.csv` separately when that label needs to change.
