# Editing `atlas.xlsx`

[`atlas.xlsx`](atlas.xlsx) is the single canonical database for Dance Atlas. It
contains two sheets: `Places` and `Regions`.

The published page fetches this workbook and builds the interactive dots, region
tray, hierarchy and village information in the visitor's browser on every load.
Save and commit an edit, then refresh the site; there is no content build or
generated index.

Village labels are rendered in the browser beside their interactive dots. They
appear on hover or keyboard focus at crowded zoom levels, then remain visible
once the complete label set no longer collides.

## `Places`

Do not rename or remove the columns:

| Column | What goes in it |
| --- | --- |
| `id` | A permanent unique ID using lowercase letters, numbers and hyphens. |
| `latitude` | Latitude between -90 and 90. |
| `longitude` | Longitude between -180 and 180. |
| `name_en` | English name. At least one name column must be filled. |
| `name_el` | Greek name. At least one name column must be filled. |
| `has_dance` | `TRUE` to create an interactive dot, map label and archive entry; `FALSE` to omit the place from the published interface. |
| `region` | A region ID from the `Regions` sheet. Required when `has_dance` is `TRUE`. |
| `subregion` | Optional display name. Leave blank for a village directly inside its region. |
| `info` | Optional Markdown about the village and its dances. Multi-line cell text is fine. |
| `kind` | Reserved classification such as `city`, `town`, or `village`; the current renderer gives every place the same visual style. |

Every `Places` row requires an ID, coordinates, at least one name, and an explicit
`has_dance` value. `TRUE`, `FALSE`, `yes`, `no`, `1`, and `0` are accepted.

The hierarchy is straightforward:

- `has_dance = TRUE`, region filled, subregion blank: village directly under the
  region.
- `has_dance = TRUE`, region and subregion filled: village inside that subregion.
- `has_dance = FALSE`: no interactive dot, label, or archive entry. Region,
  subregion and information are optional organizational notes.

## `Regions`

The `Regions` sheet controls the browse tray and archive grouping:

| Column | What goes in it |
| --- | --- |
| `id` | The permanent ID referenced by `Places.region`. |
| `name_en` / `name_el` | Region names; at least one is required. |
| `color` | A six-digit hex color such as `#e5a83f`. |
| `order` | A unique positive whole number retained for workbook compatibility. Regions display alphabetically by name. |

A region remains visible even when no place currently points to it.

## Friendly errors

If the workbook is malformed, the site shows the exact sheet, row, column, and a
plain-language explanation. For example:

```text
Places, row 14, column “latitude”: This cell must be a number.
```

Correct the named cell, save the workbook and reload. The column headers and sheet
names are part of the format and should not be changed.
