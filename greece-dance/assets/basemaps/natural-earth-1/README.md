# Natural Earth I basemap

`natural-earth-1-17e-38e-34n-44n.webp` is a static crop of Natural Earth's
**Natural Earth I with Shaded Relief, Water, and Drainages** raster. It covers
17°E–38°E and 34°N–44°N. The crop is reprojected to Web Mercator so it aligns
with MapLibre markers, and is stored at 1260×774 pixels as a quality-92 WebP.

Source archive:
<https://naciscdn.org/naturalearth/10m/raster/NE1_HR_LC_SR_W_DR.zip>

- Downloaded archive SHA-256:
  `8841d08155415f0556462846dcb845a4ccb8f12390b0e0ba36ffde55efadeb56`
- Source TIFF: 21,600×10,800 pixels, one pixel per arc minute
- Source crop: `1260x600+11820+2760`
- Natural Earth version file in the archive: `2.0.0`

Natural Earth data is in the public domain. Its
[terms of use](https://www.naturalearthdata.com/about/terms-of-use/) do not
require attribution.

To replace this with another crop from the same global raster, install Pillow
and NumPy, then run:

```bash
python3 scripts/prepare-natural-earth-basemap.py \
  NE1_HR_LC_SR_W_DR.tif \
  assets/basemaps/natural-earth-1/natural-earth-1-17e-38e-34n-44n.webp \
  --west 17 --south 34 --east 38 --north 44
```

If the geographic extent or filename changes, update `naturalEarthBasemap` in
`app.js` to match. The downloaded archive and uncropped TIFF are intentionally
not committed.
