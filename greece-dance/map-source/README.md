# Map geometry and rendering

The builder downloads Natural Earth geometry and combines it with every place in
`content/atlas.xlsx` to produce self-hosted raster tiles. The finished website
contacts no map provider or place-name service.

## Geometry cache

```bash
npm run fetch:map-data
```

This downloads country, province and lake GeoJSON into the ignored
`map-source/data/` directory. Existing downloads are reused. Pass `--force` to
replace them deliberately:

```bash
npm run fetch:map-data -- --force
```

No OpenStreetMap or Overpass data is fetched.

## Tile build

```bash
npm run build:map
```

The renderer reads the cached geometry plus `content/atlas.xlsx`, then replaces
`assets/map/` with Web Mercator WebP tiles for zoom levels 5–9 under
`assets/map/{language}/`. Each geographic tile contains 512 image pixels for a 256
CSS-pixel tile, keeping labels sharp on high-density screens and when the static
site scales beyond native zoom 9.

English and Greek tile sets are generated. Missing translated labels fall back to
the other workbook name. Country labels come from Natural Earth; populated-place
labels come only from the `Places` sheet in `atlas.xlsx`. OpenStreetMap and
Overpass are not used.

## Licensing

Natural Earth geometry is public domain:
<https://www.naturalearthdata.com/about/terms-of-use/>
