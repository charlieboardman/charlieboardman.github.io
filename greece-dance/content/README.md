# Editing `dances.md`

[`dances.md`](dances.md) is the single canonical content source for Dance Atlas.
The published page fetches and validates it in the visitor's browser on every
load. Save and commit an edit, then refresh the site; there is no content build
or generated index.

## Format

A region is a level-one heading. Its literal heading text is the English display
name:

```md
# Anatoliki Romelia // often called Northern Thrace near Burgas, Bulgaria
greek_name=Ανατολική Ρωμυλία
color=#b85c4a
```

Every region requires:

| Field | What goes in it |
| --- | --- |
| `greek_name` | The region's Greek display name. |
| `color` | A six-digit hex color such as `#e5a83f`. |

A region remains visible even when it has no villages.

A village is a level-two heading beneath its region. Its literal heading text is
the English display name:

```md
## Argithea
greek_name=Αργιθέα
latitude=39.357
longitude=21.538
subregion=Agrafa
subregion_greek_name=Άγραφα

### info
Markdown about Argithea and its dances goes here.
```

Every village requires:

| Field | What goes in it |
| --- | --- |
| `greek_name` | The village's Greek display name. |
| `latitude` | Latitude between -90 and 90. |
| `longitude` | Longitude between -180 and 180. |
| `subregion` | Optional English subregion name. |
| `subregion_greek_name` | Greek subregion name; required whenever `subregion` is present. |

Villages with the same `subregion` are grouped together in the archive. Repeat
the same `subregion_greek_name` for each of them; validation rejects conflicting
translations. Omit both subregion fields to place a village directly beneath its
region.

The optional `### info` section continues until the next village or region. Its
body is Markdown and may contain paragraphs, links, lists, emphasis and
level-four-or-deeper headings.

## Comments

Comments work globally, including inside info sections. `//` begins a comment
when it starts a line or is preceded by whitespace:

```md
// This entire line is ignored.
# Thrace // often called Western Thrace
color=#4d8f83 // source checked July 2026
```

URLs such as `https://example.com/path//segment` remain intact because their
slashes do not follow whitespace. Write `\//` to display whitespace-prefixed
double slashes literally.

## Generated keys

There are no stored IDs. The parser generates internal keys from the English
region, subregion and village names. Avoid duplicate names within the same
hierarchy and avoid names that differ only by punctuation or accents if they
would produce the same simplified key.

## Friendly errors

Malformed content produces an exact line and field in the published interface:

```text
dances.md, line 42, field “latitude”: This field must be a number.
```

Correct the named line, save the file and reload.
