# Editing `dances.md`

[`dances.md`](dances.md) is the single canonical content source for Dance Atlas.
The published page fetches and validates it in the visitor's browser on every
load. Save and commit an edit, then refresh the site; there is no content build
or generated index.

## Format

A region is a level-one heading. Its literal heading text is the English display
name:

```md
# Anatoliki Romelia <!-- often called Northern Thrace near Burgas, Bulgaria -->
greek_name=Ανατολική Ρωμυλία
color=#d71908
```

Every region requires:

| Field | What goes in it |
| --- | --- |
| `greek_name` | The region's Greek display name. |
| `color` | A six-digit hex color such as `#fe843d`. |

A region remains visible even when it has no villages.
Keep existing region colors stable. When adding a region, follow the
[palette-selection method](../README.md#region-color-palette) rather than
reassigning the existing colors.

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
English Markdown about Argithea and its dances goes here.

### info_greek
Ελληνικό κείμενο Markdown για την Αργιθέα και τους χορούς της.
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

The optional `### info` section contains the English village description. Add
an optional `### info_greek` section for its Greek counterpart. Each section
continues until the next localized info section, village, or region. Their
bodies are independent Markdown: editing one does not translate or update the
other automatically. If `info_greek` is absent or empty, the Greek interface
falls back to `info`. Search checks both languages regardless of the currently
selected interface language.

Both bodies may contain paragraphs, links, lists, emphasis and
level-four-or-deeper headings. Headings at any level inside fenced code blocks
are treated as literal code rather than region, village, or info records. A
village may have at most one section of each kind.

## Comments

Comments use standard HTML comment syntax and work globally, including inside
info sections. They can appear inline:

```md
# Thrace <!-- often called Western Thrace -->
color=#15b898 <!-- source checked July 2026 -->
```

Or span multiple lines:

```md
<!--
This entire block is ignored by the parser and hidden in GitHub's preview.
It can contain editorial notes for future contributors.
-->
```

Comments cannot be nested. To display the comment delimiters literally in an
info section, write them as `&lt;!--` and `--&gt;`.

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
