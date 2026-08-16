# ETOPO 2022 + Natural Earth hydrography basemap

These two WebP textures form one static basemap covering 12°E–38°E and
34°N–44°N. They are split at 25°E so neither texture exceeds 3120×3097 pixels,
keeping them within conservative mobile WebGL texture limits. The browser does
not contact a map provider at runtime.

The relief and bathymetry come from NOAA's 15 arc-second ETOPO 2022 surface
model. Natural Earth's 1:10m coastline, lakes, and river layers are rendered on
top. The finished image is reprojected to Web Mercator before it is split and
saved as quality-92 WebP.

## Sources

ETOPO 2022 GeoTIFF tiles:

- `ETOPO_2022_v1_15s_N45E000_surface.tif` — SHA-256
  `86f7ba59e904807fee7e035ada1ad8e761fd89d658574e91efa9e0e727f8d5d0`
- `ETOPO_2022_v1_15s_N45E015_surface.tif` — SHA-256
  `b4983c653eeb75a5a88d0dd5887192f3416aefa211e147e17a0298404cf2d5ea`
- `ETOPO_2022_v1_15s_N45E030_surface.tif` — SHA-256
  `f4d1005d3c43defc9e33260e119e4d36ad5fc18f7d452febf13f3d6223fb4c73`

The tiles are available from NOAA's
[15 arc-second surface-elevation directory](https://www.ngdc.noaa.gov/mgg/global/relief/ETOPO2022/data/15s/15s_surface_elev_gtif/).
ETOPO 2022 is dedicated to the public domain under CC0-1.0 in
[NOAA's metadata](https://www.ncei.noaa.gov/access/metadata/landing-page/bin/iso?id=gov.noaa.ngdc.mgg.dem%3Aetopo_2022).

Natural Earth archives:

- `ne_10m_coastline.zip` — SHA-256
  `bfa04cdbcbef07ef90dfca1dabb48062eca29900a113df0f389303e255484017`
- `ne_10m_lakes.zip` — SHA-256
  `0803a06f9c3cb4671d89b68c48b142aad9366ba40f665245e12a913fbc61722a`
- `ne_10m_lakes_europe.zip` — SHA-256
  `c0b1f0da4dce6af3b27c49b3ed11a664d801ff3d140ca5b9814e7e85a35c1de1`
- `ne_10m_rivers_lake_centerlines.zip` — SHA-256
  `ded71b01870855ccfe19b51f2ec14c9bb48fae23c0e9f3c11974d426433b5c38`
- `ne_10m_rivers_europe.zip` — SHA-256
  `c730ccb4cbe21c1f03d006de4032a0dc69ade342de941d10aa1facab59019dbf`

Natural Earth data is in the public domain under its
[terms of use](https://www.naturalearthdata.com/about/terms-of-use/).

## Rebuilding

Keep the downloaded GeoTIFFs in one directory and extract the Natural Earth
archives into another. With Pillow, NumPy, and pyshp installed, run:

```bash
python3 scripts/build-etopo-basemap.py \
  path/to/etopo-tiles \
  path/to/natural-earth-shapefiles \
  assets/basemaps/etopo-2022-hydrography \
  --west 12 --south 34 --east 38 --north 44 --split-longitude 25
```

The source archives and GeoTIFFs are intentionally not committed. If the
extent, split, or filenames change, update `etopoBasemapSegments` in `app.js`.
