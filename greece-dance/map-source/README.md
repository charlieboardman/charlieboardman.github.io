# Map geometry and rendering

The builder downloads Natural Earth geometry and produces self-hosted,
geometry-only raster tiles. The finished website contacts no map provider or
place-name service.

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

The renderer reads the cached geometry, then replaces `assets/map/` with Web
Mercator WebP tiles for zoom levels 5–9. Each geographic tile contains 512 image
pixels for a 256 CSS-pixel tile, keeping borders sharp on high-density screens
and when the static site scales beyond native zoom 9.

The tiles contain no text. Village labels come from `content/dances.md` and are
rendered by the browser as a collision-aware interactive overlay. OpenStreetMap
and Overpass are not used.

## Licensing

Natural Earth geometry is public domain:
<https://www.naturalearthdata.com/about/terms-of-use/>
