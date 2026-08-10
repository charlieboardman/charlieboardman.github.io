#!/usr/bin/env python3
"""Build the atlas's land-only shaded-relief raster tile pyramid from SRTMGL3S."""

from __future__ import annotations

import argparse
import io
import math
import re
import sqlite3
import tempfile
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

try:
    import shapefile
except ImportError as error:
    raise SystemExit("This script requires pyshp: python3 -m pip install pyshp") from error


TILE_SIZE = 256
SAMPLES_PER_DEGREE = 1200
VOID_ELEVATION = -32768
WATER_COLOR = np.array([180, 216, 233], dtype=np.float32)
LAND_STOPS = np.array([0, 150, 400, 800, 1400, 2200, 3200, 5000], dtype=np.float32)
LAND_COLORS = np.array(
    [
        [190, 216, 174],
        [198, 219, 177],
        [207, 218, 176],
        [211, 209, 164],
        [204, 194, 151],
        [190, 174, 139],
        [207, 195, 176],
        [238, 234, 222],
    ],
    dtype=np.float32,
)
HGT_NAME = re.compile(r"^N(?P<latitude>\d{2})E(?P<longitude>\d{3})\.hgt$")


@dataclass(frozen=True)
class Feature:
    bbox: tuple[float, float, float, float]
    parts: tuple[tuple[tuple[float, float], ...], ...]
    scale_rank: int = 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Render a Web-Mercator MBTiles pyramid from 3 arc-second SRTM land elevation."
    )
    parser.add_argument("hgt_dir", type=Path, help="Directory containing unzipped SRTMGL3S .hgt files")
    parser.add_argument("hydrography_dir", type=Path, help="Extracted Natural Earth shapefiles")
    parser.add_argument("output", type=Path, help="Output MBTiles path")
    parser.add_argument("--west", type=int, default=12)
    parser.add_argument("--south", type=int, default=34)
    parser.add_argument("--east", type=int, default=38)
    parser.add_argument("--north", type=int, default=44)
    parser.add_argument("--min-zoom", type=int, default=0)
    parser.add_argument("--max-zoom", type=int, default=11)
    parser.add_argument("--quality", type=int, default=76, help="WebP quality (default: 76)")
    parser.add_argument(
        "--work-dir",
        type=Path,
        help="Directory for the temporary 750 MB elevation mosaic (default: system temporary directory)",
    )
    return parser.parse_args()


def tile_x(longitude: float, zoom: int) -> float:
    return (longitude + 180.0) / 360.0 * (1 << zoom)


def tile_y(latitude: float, zoom: int) -> float:
    latitude = max(-85.05112878, min(85.05112878, latitude))
    radians = math.radians(latitude)
    return (1.0 - math.asinh(math.tan(radians)) / math.pi) / 2.0 * (1 << zoom)


def latitude_at_pixel(pixel_y: np.ndarray, zoom: int) -> np.ndarray:
    world_size = TILE_SIZE * (1 << zoom)
    mercator_y = math.pi * (1.0 - 2.0 * pixel_y / world_size)
    return np.degrees(np.arctan(np.sinh(mercator_y)))


def tile_range(args: argparse.Namespace, zoom: int) -> tuple[int, int, int, int]:
    tiles = 1 << zoom
    x_min = max(0, math.floor(tile_x(args.west, zoom)))
    x_max = min(tiles - 1, math.ceil(tile_x(args.east, zoom)) - 1)
    y_min = max(0, math.floor(tile_y(args.north, zoom)))
    y_max = min(tiles - 1, math.ceil(tile_y(args.south, zoom)) - 1)
    return x_min, y_min, x_max, y_max


def build_elevation_mosaic(args: argparse.Namespace, mosaic_path: Path) -> np.memmap:
    height = (args.north - args.south) * SAMPLES_PER_DEGREE + 1
    width = (args.east - args.west) * SAMPLES_PER_DEGREE + 1
    mosaic = np.memmap(mosaic_path, dtype=np.int16, mode="w+", shape=(height, width))
    mosaic[:] = 0

    loaded = 0
    for path in sorted(args.hgt_dir.glob("*.hgt")):
        match = HGT_NAME.match(path.name)
        if not match:
            continue
        latitude = int(match.group("latitude"))
        longitude = int(match.group("longitude"))
        if not (
            args.south <= latitude < args.north
            and args.west <= longitude < args.east
        ):
            continue
        source = np.memmap(path, dtype=">i2", mode="r", shape=(1201, 1201))
        row = (args.north - latitude - 1) * SAMPLES_PER_DEGREE
        column = (longitude - args.west) * SAMPLES_PER_DEGREE
        values = np.asarray(source, dtype=np.int16)
        values = np.where(values == VOID_ELEVATION, 0, values)
        mosaic[row : row + 1201, column : column + 1201] = values
        loaded += 1

    if loaded == 0:
        raise FileNotFoundError(f"No in-bounds SRTM .hgt files found in {args.hgt_dir}")
    mosaic.flush()
    print(f"Loaded {loaded} SRTM granules into {width:,} x {height:,} mosaic", flush=True)
    return mosaic


def shape_parts(shape: shapefile.Shape) -> tuple[tuple[tuple[float, float], ...], ...]:
    starts = list(shape.parts) + [len(shape.points)]
    return tuple(
        tuple(shape.points[starts[index] : starts[index + 1]])
        for index in range(len(starts) - 1)
    )


def intersects_bounds(
    bbox: tuple[float, float, float, float],
    bounds: tuple[float, float, float, float],
) -> bool:
    west, south, east, north = bounds
    shape_west, shape_south, shape_east, shape_north = bbox
    return shape_east >= west and shape_west <= east and shape_north >= south and shape_south <= north


def load_hydrography(
    directory: Path,
    bounds: tuple[float, float, float, float],
) -> tuple[list[Feature], list[Feature], list[Feature]]:
    lakes: list[Feature] = []
    coastlines: list[Feature] = []
    rivers: list[Feature] = []

    lake_paths = sorted(directory.glob("ne_10m_lakes*.shp"))
    river_paths = sorted(directory.glob("ne_10m_rivers*.shp"))
    coastline_path = directory / "ne_10m_coastline.shp"
    if not lake_paths or not river_paths or not coastline_path.exists():
        raise FileNotFoundError(f"Natural Earth hydrography shapefiles are incomplete in {directory}")

    for path in lake_paths:
        for shape in shapefile.Reader(path).iterShapes():
            bbox = tuple(shape.bbox)
            if intersects_bounds(bbox, bounds):
                lakes.append(Feature(bbox, shape_parts(shape)))

    for shape in shapefile.Reader(coastline_path).iterShapes():
        bbox = tuple(shape.bbox)
        if intersects_bounds(bbox, bounds):
            coastlines.append(Feature(bbox, shape_parts(shape)))

    for path in river_paths:
        reader = shapefile.Reader(path)
        fields = [field[0] for field in reader.fields[1:]]
        for item in reader.iterShapeRecords():
            bbox = tuple(item.shape.bbox)
            if not intersects_bounds(bbox, bounds):
                continue
            attributes = dict(zip(fields, item.record))
            rivers.append(
                Feature(bbox, shape_parts(item.shape), int(attributes.get("scalerank", 12)))
            )

    print(
        f"Loaded {len(coastlines)} coastline, {len(lakes)} lake, and {len(rivers)} river features",
        flush=True,
    )
    return lakes, coastlines, rivers


def sample_elevation(
    mosaic: np.memmap,
    args: argparse.Namespace,
    zoom: int,
    x_start: int,
    x_end: int,
    tile_row: int,
    buffer: int = 2,
) -> tuple[np.ndarray, np.ndarray]:
    pixel_x = np.arange(
        x_start * TILE_SIZE - buffer,
        (x_end + 1) * TILE_SIZE + buffer,
        dtype=np.float64,
    ) + 0.5
    pixel_y = np.arange(
        tile_row * TILE_SIZE - buffer,
        (tile_row + 1) * TILE_SIZE + buffer,
        dtype=np.float64,
    ) + 0.5
    world_size = TILE_SIZE * (1 << zoom)
    longitudes = pixel_x / world_size * 360.0 - 180.0
    latitudes = latitude_at_pixel(pixel_y, zoom)
    source_x = (longitudes - args.west) * SAMPLES_PER_DEGREE
    source_y = (args.north - latitudes) * SAMPLES_PER_DEGREE

    valid_x = (source_x >= 0) & (source_x <= mosaic.shape[1] - 1)
    valid_y = (source_y >= 0) & (source_y <= mosaic.shape[0] - 1)
    x0 = np.clip(np.floor(source_x).astype(np.int32), 0, mosaic.shape[1] - 1)
    x1 = np.minimum(x0 + 1, mosaic.shape[1] - 1)
    x_weight = (source_x - np.floor(source_x)).astype(np.float32)
    y0 = np.clip(np.floor(source_y).astype(np.int32), 0, mosaic.shape[0] - 1)
    y1 = np.minimum(y0 + 1, mosaic.shape[0] - 1)
    y_weight = (source_y - np.floor(source_y)).astype(np.float32)

    sampled = np.zeros((len(pixel_y), len(pixel_x)), dtype=np.float32)
    land = np.zeros_like(sampled, dtype=bool)
    nearest_x = np.clip(np.rint(source_x).astype(np.int32), 0, mosaic.shape[1] - 1)
    for output_row in range(len(pixel_y)):
        if not valid_y[output_row]:
            continue
        upper = np.asarray(mosaic[y0[output_row], x0], dtype=np.float32)
        upper += (np.asarray(mosaic[y0[output_row], x1], dtype=np.float32) - upper) * x_weight
        lower = np.asarray(mosaic[y1[output_row], x0], dtype=np.float32)
        lower += (np.asarray(mosaic[y1[output_row], x1], dtype=np.float32) - lower) * x_weight
        sampled[output_row] = upper + (lower - upper) * y_weight[output_row]
        nearest_y = int(round(source_y[output_row]))
        land[output_row] = np.asarray(mosaic[nearest_y, nearest_x]) > 0
    sampled[:, ~valid_x] = 0
    land[:, ~valid_x] = False
    sampled[~land] = 0
    return sampled, land


def interpolate_land(elevation: np.ndarray) -> np.ndarray:
    return np.stack(
        [
            np.interp(elevation, LAND_STOPS, LAND_COLORS[:, channel])
            for channel in range(3)
        ],
        axis=-1,
    )


def render_relief(
    elevation: np.ndarray,
    land: np.ndarray,
    zoom: int,
    tile_row: int,
    buffer: int = 2,
) -> Image.Image:
    world_size = TILE_SIZE * (1 << zoom)
    pixel_rows = np.arange(
        tile_row * TILE_SIZE - buffer,
        (tile_row + 1) * TILE_SIZE + buffer,
        dtype=np.float64,
    ) + 0.5
    latitudes = latitude_at_pixel(pixel_rows, zoom)
    ground_spacing = 40_075_016.686 * np.cos(np.radians(latitudes)) / world_size

    exaggeration = 1.55
    dz_dx = np.gradient(elevation, axis=1) * exaggeration / ground_spacing[:, np.newaxis]
    dz_dy = -np.gradient(elevation, axis=0) * exaggeration / ground_spacing[:, np.newaxis]
    normal_x = -dz_dx
    normal_y = -dz_dy
    normal_length = np.sqrt(normal_x**2 + normal_y**2 + 1)

    altitude = math.radians(45)
    azimuth = math.radians(315)
    light_x = math.cos(altitude) * math.sin(azimuth)
    light_y = math.cos(altitude) * math.cos(azimuth)
    light_z = math.sin(altitude)
    illumination = (normal_x * light_x + normal_y * light_y + light_z) / normal_length
    illumination = np.clip(illumination, 0, 1)

    land_rgb = interpolate_land(np.maximum(elevation, 0))
    pixels = np.broadcast_to(WATER_COLOR, land_rgb.shape).copy()
    flat_light = math.sin(altitude)
    light_factor = np.clip(1 + 0.78 * (illumination - flat_light), 0.56, 1.20)
    shaded_land = land_rgb * light_factor[:, :, np.newaxis]
    pixels[land] = shaded_land[land]
    pixels = pixels[buffer:-buffer, buffer:-buffer]
    return Image.fromarray(np.rint(np.clip(pixels, 0, 255)).astype(np.uint8), "RGB")


def projected_points(
    points: tuple[tuple[float, float], ...],
    zoom: int,
    origin_x: int,
    origin_y: int,
) -> list[tuple[float, float]]:
    return [
        (
            tile_x(longitude, zoom) * TILE_SIZE - origin_x,
            tile_y(latitude, zoom) * TILE_SIZE - origin_y,
        )
        for longitude, latitude in points
    ]


def ring_area(points: tuple[tuple[float, float], ...]) -> float:
    return sum(
        x1 * y2 - x2 * y1
        for (x1, y1), (x2, y2) in zip(points, points[1:] + points[:1])
    ) / 2


def strip_bounds(zoom: int, x_start: int, x_end: int, tile_row: int) -> tuple[float, float, float, float]:
    tiles = 1 << zoom
    west = x_start / tiles * 360.0 - 180.0
    east = (x_end + 1) / tiles * 360.0 - 180.0
    north = float(latitude_at_pixel(np.array([tile_row * TILE_SIZE]), zoom)[0])
    south = float(latitude_at_pixel(np.array([(tile_row + 1) * TILE_SIZE]), zoom)[0])
    return west, south, east, north


def add_hydrography(
    image: Image.Image,
    zoom: int,
    x_start: int,
    x_end: int,
    tile_row: int,
    lakes: list[Feature],
    coastlines: list[Feature],
    rivers: list[Feature],
) -> Image.Image:
    bounds = strip_bounds(zoom, x_start, x_end, tile_row)
    origin_x = x_start * TILE_SIZE
    origin_y = tile_row * TILE_SIZE
    lake_mask = Image.new("L", image.size, 0)
    lake_draw = ImageDraw.Draw(lake_mask)
    lake_outlines: list[list[tuple[float, float]]] = []
    for feature in lakes:
        if not intersects_bounds(feature.bbox, bounds):
            continue
        for ring in feature.parts:
            points = projected_points(ring, zoom, origin_x, origin_y)
            lake_draw.polygon(points, fill=255 if ring_area(ring) < 0 else 0)
            lake_outlines.append(points)

    rendered = image.copy()
    rendered.paste(tuple(int(value) for value in WATER_COLOR), mask=lake_mask)
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    line_width = 1 if zoom <= 7 else 2

    # Natural Earth's 1:10m coastline is useful at an atlas scale but visibly
    # coarser than SRTM when deeply zoomed. At z9+, the elevation-derived land
    # edge is both cleaner and more accurately registered.
    if zoom <= 8:
        for feature in coastlines:
            if not intersects_bounds(feature.bbox, bounds):
                continue
            for line in feature.parts:
                draw.line(
                    projected_points(line, zoom, origin_x, origin_y),
                    fill=(64, 103, 108, 175),
                    width=line_width,
                    joint="curve",
                )
    for ring in lake_outlines:
        draw.line(ring, fill=(74, 132, 151, 185), width=line_width, joint="curve")
    for feature in sorted(rivers, key=lambda item: item.scale_rank, reverse=True):
        if feature.scale_rank > max(5, 13 - zoom) or not intersects_bounds(feature.bbox, bounds):
            continue
        river_width = 1 if feature.scale_rank >= 7 or zoom <= 7 else 2
        for line in feature.parts:
            draw.line(
                projected_points(line, zoom, origin_x, origin_y),
                fill=(61, 143, 180, 175),
                width=river_width,
                joint="curve",
            )
    return Image.alpha_composite(rendered.convert("RGBA"), overlay).convert("RGB")


def encode_webp(image: Image.Image, quality: int) -> bytes:
    output = io.BytesIO()
    image.save(output, "WEBP", quality=quality, method=6, exact=True)
    return output.getvalue()


def initialize_database(path: Path, args: argparse.Namespace) -> sqlite3.Connection:
    if path.exists():
        path.unlink()
    connection = sqlite3.connect(path)
    connection.execute("PRAGMA journal_mode=OFF")
    connection.execute("PRAGMA synchronous=OFF")
    connection.execute(
        "CREATE TABLE metadata (name TEXT PRIMARY KEY, value TEXT NOT NULL)"
    )
    connection.execute(
        "CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB)"
    )
    metadata = {
        "name": "Dance Atlas SRTM shaded relief",
        "description": "Land-only shaded relief from NASA SRTMGL3S with Natural Earth hydrography",
        "type": "baselayer",
        "version": "1",
        "format": "webp",
        "bounds": f"{args.west},{args.south},{args.east},{args.north}",
        "center": f"{(args.west + args.east) / 2},{(args.south + args.north) / 2},6",
        "minzoom": str(args.min_zoom),
        "maxzoom": str(args.max_zoom),
        "attribution": "",
    }
    connection.executemany("INSERT INTO metadata VALUES (?, ?)", metadata.items())
    return connection


def render_pyramid(
    connection: sqlite3.Connection,
    mosaic: np.memmap,
    args: argparse.Namespace,
    hydrography: tuple[list[Feature], list[Feature], list[Feature]],
) -> None:
    lakes, coastlines, rivers = hydrography
    total_tiles = sum(
        (bounds[2] - bounds[0] + 1) * (bounds[3] - bounds[1] + 1)
        for zoom in range(args.min_zoom, args.max_zoom + 1)
        for bounds in [tile_range(args, zoom)]
    )
    completed = 0
    for zoom in range(args.min_zoom, args.max_zoom + 1):
        x_min, y_min, x_max, y_max = tile_range(args, zoom)
        for y in range(y_min, y_max + 1):
            elevation, land = sample_elevation(mosaic, args, zoom, x_min, x_max, y)
            strip = render_relief(elevation, land, zoom, y)
            strip = add_hydrography(
                strip, zoom, x_min, x_max, y, lakes, coastlines, rivers
            )
            records = []
            for x in range(x_min, x_max + 1):
                left = (x - x_min) * TILE_SIZE
                tile = strip.crop((left, 0, left + TILE_SIZE, TILE_SIZE))
                tms_row = (1 << zoom) - 1 - y
                records.append((zoom, x, tms_row, encode_webp(tile, args.quality)))
            connection.executemany("INSERT INTO tiles VALUES (?, ?, ?, ?)", records)
            connection.commit()
            completed += len(records)
            print(
                f"z{zoom} row {y - y_min + 1}/{y_max - y_min + 1}: "
                f"{completed:,}/{total_tiles:,} tiles",
                flush=True,
            )
    connection.execute(
        "CREATE UNIQUE INDEX tile_index ON tiles (zoom_level, tile_column, tile_row)"
    )
    connection.commit()


def main() -> None:
    args = parse_args()
    if args.west >= args.east or args.south >= args.north:
        raise SystemExit("Crop bounds are invalid")
    if args.min_zoom < 0 or args.max_zoom < args.min_zoom:
        raise SystemExit("Zoom range is invalid")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    bounds = (args.west, args.south, args.east, args.north)
    hydrography = load_hydrography(args.hydrography_dir, bounds)

    if args.work_dir:
        args.work_dir.mkdir(parents=True, exist_ok=True)
        mosaic_path = args.work_dir / "srtm-mosaic.int16"
        mosaic = build_elevation_mosaic(args, mosaic_path)
        connection = initialize_database(args.output, args)
        try:
            render_pyramid(connection, mosaic, args, hydrography)
        finally:
            connection.close()
    else:
        with tempfile.TemporaryDirectory(prefix="dance-atlas-srtm-") as temporary:
            mosaic = build_elevation_mosaic(args, Path(temporary) / "srtm-mosaic.int16")
            connection = initialize_database(args.output, args)
            try:
                render_pyramid(connection, mosaic, args, hydrography)
            finally:
                connection.close()
    print(f"Wrote {args.output} ({args.output.stat().st_size / 1_000_000:.1f} MB)")


if __name__ == "__main__":
    main()
