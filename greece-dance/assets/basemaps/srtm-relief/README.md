# SRTM land-relief basemap

`greece-srtm-relief.pmtiles` is the atlas's static, range-addressable raster
basemap. It covers 12°E–38°E and 34°N–44°N at zoom levels 0–11. The highest
zoom is rendered from 3 arc-second (roughly 90 m) land elevation; the sea is a
single flat color, with no bathymetry. The browser fetches only the header,
index, and visible WebP tiles from this archive rather than downloading all
46 MB on each visit.

The terrain comes from NASA's version-3 SRTMGL3S product. Natural Earth's
1:10m lakes and rivers are drawn over it, along with its coastline at overview
zooms. At deep zooms the coastline follows the more detailed SRTM land mask.
The resulting archive contains 15,037 addressed tiles and 8,365 distinct tile
images. Its SHA-256 is:

```text
4160acb2a2e89f79cb4ec7664b80eaf11840e0a4c9c7de1b263dccb687a46b5e  greece-srtm-relief.pmtiles
```

## Sources and rights

NASA's [SRTMGL3S version 3 dataset](https://doi.org/10.5067/MEaSUREs/SRTM/SRTMGL3S.003)
provides one signed 16-bit, 1201×1201 elevation grid per one-degree land
granule. It is a work of the United States government and is not subject to
copyright in the United States. NASA's canonical download requires a free
Earthdata login; these build inputs were downloaded without modification from
the public `https://srtm.fasma.org/` mirror. The exact 200 source archive names
and checksums are in [`SRTMGL3S-SHA256SUMS`](SRTMGL3S-SHA256SUMS). That
manifest's SHA-256 is
`c01fa98b35b4cce653d7b55e60ad3edaa5ba18099e3b3ba5af813d157f28c6c4`.
Granules absent from the mirror in this crop are open ocean and are rendered
as water.

Natural Earth inputs:

- `ne_10m_coastline.zip` — `bfa04cdbcbef07ef90dfca1dabb48062eca29900a113df0f389303e255484017`
- `ne_10m_lakes.zip` — `0803a06f9c3cb4671d89b68c48b142aad9366ba40f665245e12a913fbc61722a`
- `ne_10m_lakes_europe.zip` — `c0b1f0da4dce6af3b27c49b3ed11a664d801ff3d140ca5b9814e7e85a35c1de1`
- `ne_10m_rivers_lake_centerlines.zip` — `ded71b01870855ccfe19b51f2ec14c9bb48fae23c0e9f3c11974d426433b5c38`
- `ne_10m_rivers_europe.zip` — `c730ccb4cbe21c1f03d006de4032a0dc69ade342de941d10aa1facab59019dbf`

Natural Earth makes all of its data available under its
[public-domain terms of use](https://www.naturalearthdata.com/about/terms-of-use/).
Neither source requires map attribution.

## Rebuilding or extending the map

Keep source material outside the repository: one directory of extracted
`.hgt` files and one directory of extracted Natural Earth shapefiles. The
committed bounds are arguments to the renderer, so a future build can cover a
larger rectangle without reorganizing the app or archive layout.

Requirements are Python 3, Pillow, NumPy, pyshp, and the
[`go-pmtiles`](https://github.com/protomaps/go-pmtiles) command. The committed
archive was encoded as quality-76 WebP and packed with go-pmtiles 1.31.2:

```bash
python3 scripts/build-srtm-basemap.py \
  path/to/srtm-hgt \
  path/to/natural-earth-shapefiles \
  /tmp/greece-srtm-relief.mbtiles \
  --west 12 --south 34 --east 38 --north 44 \
  --min-zoom 0 --max-zoom 11 --quality 76 \
  --work-dir /tmp/dance-atlas-srtm-work

go-pmtiles convert \
  /tmp/greece-srtm-relief.mbtiles \
  assets/basemaps/srtm-relief/greece-srtm-relief.pmtiles

go-pmtiles verify \
  assets/basemaps/srtm-relief/greece-srtm-relief.pmtiles
```

The work directory holds a roughly 750 MB memory-mapped elevation mosaic. The
raw SRTM granules and intermediate MBTiles file are intentionally not
committed.
