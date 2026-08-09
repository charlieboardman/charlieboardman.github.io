#!/usr/bin/env python3
"""Build the static ETOPO/Natural Earth basemap used by the atlas."""

from __future__ import annotations

import argparse
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

try:
    import shapefile
except ImportError as error:
    raise SystemExit("This script requires pyshp: python3 -m pip install pyshp") from error


Image.MAX_IMAGE_PIXELS = 100_000_000

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
SEA_STOPS = np.array([0, 80, 250, 700, 1500, 3000, 5000, 7000], dtype=np.float32)
SEA_COLORS = np.array(
    [
        [180, 216, 233],
        [174, 211, 230],
        [165, 204, 226],
        [151, 193, 219],
        [135, 178, 209],
        [116, 158, 193],
        [101, 139, 176],
        [88, 121, 158],
    ],
    dtype=np.float32,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Render a Web-Mercator shaded-relief basemap from ETOPO and Natural Earth."
    )
    parser.add_argument("etopo_dir", type=Path, help="Directory containing ETOPO GeoTIFF tiles")
    parser.add_argument("hydrography_dir", type=Path, help="Extracted Natural Earth shapefiles")
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--west", type=float, required=True)
    parser.add_argument("--south", type=float, required=True)
    parser.add_argument("--east", type=float, required=True)
    parser.add_argument("--north", type=float, required=True)
    parser.add_argument(
        "--split-longitude",
        type=float,
        help="Split the output into two textures at this longitude",
    )
    parser.add_argument("--quality", type=int, default=92, help="WebP quality (default: 92)")
    return parser.parse_args()


def exact_pixel(value: float, label: str) -> int:
    rounded = round(value)
    if not math.isclose(value, rounded, abs_tol=1e-6):
        raise ValueError(f"{label} does not fall on an ETOPO pixel edge: {value}")
    return rounded


def load_elevation(args: argparse.Namespace) -> tuple[np.ndarray, float]:
    tile_paths = sorted(args.etopo_dir.glob("ETOPO_2022_v1_15s_*_surface.tif"))
    if not tile_paths:
        raise FileNotFoundError(f"No ETOPO surface tiles found in {args.etopo_dir}")

    pixels_per_degree = None
    target = None
    covered = None

    for tile_path in tile_paths:
        with Image.open(tile_path) as tile_image:
            scale = tile_image.tag_v2.get(33550)
            tiepoint = tile_image.tag_v2.get(33922)
            if not scale or not tiepoint:
                raise ValueError(f"Missing GeoTIFF transform tags in {tile_path}")
            tile_resolution = 1 / float(scale[0])
            if pixels_per_degree is None:
                pixels_per_degree = tile_resolution
                width = exact_pixel((args.east - args.west) * pixels_per_degree, "width")
                height = exact_pixel((args.north - args.south) * pixels_per_degree, "height")
                target = np.full((height, width), np.nan, dtype=np.float32)
                covered = np.zeros((height, width), dtype=bool)
            elif not math.isclose(tile_resolution, pixels_per_degree):
                raise ValueError("ETOPO tiles do not share a resolution")

            tile_west = float(tiepoint[3])
            tile_north = float(tiepoint[4])
            tile_east = tile_west + tile_image.width / pixels_per_degree
            tile_south = tile_north - tile_image.height / pixels_per_degree
            west = max(args.west, tile_west)
            east = min(args.east, tile_east)
            south = max(args.south, tile_south)
            north = min(args.north, tile_north)
            if west >= east or south >= north:
                continue

            source_left = exact_pixel((west - tile_west) * pixels_per_degree, "source west")
            source_right = exact_pixel((east - tile_west) * pixels_per_degree, "source east")
            source_top = exact_pixel((tile_north - north) * pixels_per_degree, "source north")
            source_bottom = exact_pixel((tile_north - south) * pixels_per_degree, "source south")
            target_left = exact_pixel((west - args.west) * pixels_per_degree, "target west")
            target_right = exact_pixel((east - args.west) * pixels_per_degree, "target east")
            target_top = exact_pixel((args.north - north) * pixels_per_degree, "target north")
            target_bottom = exact_pixel((args.north - south) * pixels_per_degree, "target south")

            tile = np.asarray(tile_image, dtype=np.float32)
            target[target_top:target_bottom, target_left:target_right] = tile[
                source_top:source_bottom, source_left:source_right
            ]
            covered[target_top:target_bottom, target_left:target_right] = True

    if target is None or covered is None or pixels_per_degree is None:
        raise RuntimeError("Could not initialize the ETOPO mosaic")
    if not covered.all():
        missing = int(covered.size - covered.sum())
        raise ValueError(f"ETOPO tiles leave {missing:,} output pixels uncovered")
    return target, pixels_per_degree


def smooth_grid(values: np.ndarray, passes: int = 2) -> np.ndarray:
    smoothed = values
    for _ in range(passes):
        padded = np.pad(smoothed, ((0, 0), (2, 2)), mode="edge")
        smoothed = (
            padded[:, :-4]
            + 4 * padded[:, 1:-3]
            + 6 * padded[:, 2:-2]
            + 4 * padded[:, 3:-1]
            + padded[:, 4:]
        ) / 16
        padded = np.pad(smoothed, ((2, 2), (0, 0)), mode="edge")
        smoothed = (
            padded[:-4]
            + 4 * padded[1:-3]
            + 6 * padded[2:-2]
            + 4 * padded[3:-1]
            + padded[4:]
        ) / 16
    return smoothed.astype(np.float32)


def hillshade(
    elevation: np.ndarray,
    pixels_per_degree: float,
    north: float,
) -> np.ndarray:
    smoothed = smooth_grid(elevation)
    latitudes = north - (np.arange(elevation.shape[0]) + 0.5) / pixels_per_degree
    meters_per_degree = 111_320.0
    east_west_spacing = (
        meters_per_degree * np.cos(np.radians(latitudes)) / pixels_per_degree
    )[:, np.newaxis]
    north_south_spacing = meters_per_degree / pixels_per_degree
    exaggeration = 1.6
    dz_dx = np.gradient(smoothed, axis=1) * exaggeration / east_west_spacing
    dz_dy = -np.gradient(smoothed, axis=0) * exaggeration / north_south_spacing

    normal_x = -dz_dx
    normal_y = -dz_dy
    normal_z = np.ones_like(smoothed)
    normal_length = np.sqrt(normal_x**2 + normal_y**2 + normal_z**2)

    altitude = math.radians(45)
    azimuth = math.radians(315)
    light_x = math.cos(altitude) * math.sin(azimuth)
    light_y = math.cos(altitude) * math.cos(azimuth)
    light_z = math.sin(altitude)
    illumination = (
        normal_x * light_x + normal_y * light_y + normal_z * light_z
    ) / normal_length
    return np.clip(illumination, 0, 1).astype(np.float32)


def interpolate_palette(values: np.ndarray, stops: np.ndarray, colors: np.ndarray) -> np.ndarray:
    return np.stack(
        [np.interp(values, stops, colors[:, channel]) for channel in range(3)],
        axis=-1,
    )


def colorize(elevation: np.ndarray, shade: np.ndarray) -> Image.Image:
    land = elevation >= 0
    land_rgb = interpolate_palette(np.maximum(elevation, 0), LAND_STOPS, LAND_COLORS)
    sea_rgb = interpolate_palette(np.maximum(-elevation, 0), SEA_STOPS, SEA_COLORS)
    pixels = np.where(land[:, :, np.newaxis], land_rgb, sea_rgb)

    flat_light = math.sin(math.radians(45))
    land_factor = np.clip(1 + 0.78 * (shade - flat_light), 0.58, 1.18)
    sea_factor = np.clip(1 + 0.34 * (shade - flat_light), 0.78, 1.10)
    factor = np.where(land, land_factor, sea_factor)
    pixels *= factor[:, :, np.newaxis]
    return Image.fromarray(np.rint(np.clip(pixels, 0, 255)).astype(np.uint8), mode="RGB")


def parts(shape: shapefile.Shape) -> list[list[tuple[float, float]]]:
    starts = list(shape.parts) + [len(shape.points)]
    return [shape.points[starts[index] : starts[index + 1]] for index in range(len(starts) - 1)]


def intersects(shape: shapefile.Shape, bounds: tuple[float, float, float, float]) -> bool:
    west, south, east, north = bounds
    shape_west, shape_south, shape_east, shape_north = shape.bbox
    return shape_east >= west and shape_west <= east and shape_north >= south and shape_south <= north


def projected_points(
    points: list[tuple[float, float]],
    bounds: tuple[float, float, float, float],
    pixels_per_degree: float,
) -> list[tuple[float, float]]:
    west, _south, _east, north = bounds
    return [
        ((longitude - west) * pixels_per_degree, (north - latitude) * pixels_per_degree)
        for longitude, latitude in points
    ]


def ring_area(points: list[tuple[float, float]]) -> float:
    return sum(
        x1 * y2 - x2 * y1
        for (x1, y1), (x2, y2) in zip(points, points[1:] + points[:1])
    ) / 2


def add_hydrography(
    image: Image.Image,
    hydrography_dir: Path,
    bounds: tuple[float, float, float, float],
    pixels_per_degree: float,
) -> Image.Image:
    lake_mask = Image.new("L", image.size, 0)
    lake_draw = ImageDraw.Draw(lake_mask)
    lake_rings: list[list[tuple[float, float]]] = []
    for path in sorted(hydrography_dir.glob("ne_10m_lakes*.shp")):
        for shape in shapefile.Reader(path).iterShapes():
            if not intersects(shape, bounds):
                continue
            for ring in parts(shape):
                projected = projected_points(ring, bounds, pixels_per_degree)
                lake_draw.polygon(projected, fill=255 if ring_area(ring) < 0 else 0)
                lake_rings.append(projected)

    rendered = image.copy()
    rendered.paste((165, 207, 226), mask=lake_mask)
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    coastline = hydrography_dir / "ne_10m_coastline.shp"
    for shape in shapefile.Reader(coastline).iterShapes():
        if not intersects(shape, bounds):
            continue
        for line in parts(shape):
            draw.line(
                projected_points(line, bounds, pixels_per_degree),
                fill=(64, 103, 108, 165),
                width=4,
                joint="curve",
            )

    for ring in lake_rings:
        draw.line(ring, fill=(74, 132, 151, 175), width=3, joint="curve")

    river_records = []
    for path in sorted(hydrography_dir.glob("ne_10m_rivers*.shp")):
        reader = shapefile.Reader(path)
        field_names = [field[0] for field in reader.fields[1:]]
        for item in reader.iterShapeRecords():
            if not intersects(item.shape, bounds):
                continue
            attributes = dict(zip(field_names, item.record))
            river_records.append((int(attributes.get("scalerank", 12)), item.shape))
    for scale_rank, shape in sorted(river_records, key=lambda item: item[0], reverse=True):
        width = 2 if scale_rank >= 10 else 3 if scale_rank >= 7 else 4 if scale_rank >= 4 else 5
        alpha = 150 if scale_rank >= 10 else 175
        for line in parts(shape):
            draw.line(
                projected_points(line, bounds, pixels_per_degree),
                fill=(61, 143, 180, alpha),
                width=width,
                joint="curve",
            )

    return Image.alpha_composite(rendered.convert("RGBA"), overlay).convert("RGB")


def mercator_y(latitude: float) -> float:
    return math.asinh(math.tan(math.radians(latitude)))


def inverse_mercator_y(value: np.ndarray) -> np.ndarray:
    return np.degrees(np.arctan(np.sinh(value)))


def reproject_web_mercator(
    image: Image.Image,
    south: float,
    north: float,
    pixels_per_degree: float,
) -> Image.Image:
    north_y = mercator_y(north)
    south_y = mercator_y(south)
    target_height = round(
        (north_y - south_y) / math.radians(1 / pixels_per_degree)
    )
    target_y = north_y - (
        (np.arange(target_height, dtype=np.float64) + 0.5)
        / target_height
        * (north_y - south_y)
    )
    target_latitudes = inverse_mercator_y(target_y)
    source_rows = (north - target_latitudes) * pixels_per_degree - 0.5
    source_rows = np.clip(source_rows, 0, image.height - 1)
    row_before = np.floor(source_rows).astype(np.int32)
    row_after = np.minimum(row_before + 1, image.height - 1)
    row_weight = source_rows - row_before

    source_pixels = np.asarray(image, dtype=np.float32)
    target_pixels = np.empty((target_height, image.width, 3), dtype=np.uint8)
    for start in range(0, target_height, 256):
        end = min(start + 256, target_height)
        weight = row_weight[start:end, np.newaxis, np.newaxis]
        chunk = (
            source_pixels[row_before[start:end]] * (1 - weight)
            + source_pixels[row_after[start:end]] * weight
        )
        target_pixels[start:end] = np.rint(chunk).astype(np.uint8)
    return Image.fromarray(target_pixels, mode="RGB")


def coordinate_name(value: float, positive: str, negative: str) -> str:
    magnitude = f"{abs(value):g}".replace(".", "p")
    return f"{magnitude}{positive if value >= 0 else negative}"


def output_name(west: float, east: float, south: float, north: float) -> str:
    return "etopo-2022-hydrography-{}-{}-{}-{}.webp".format(
        coordinate_name(west, "e", "w"),
        coordinate_name(east, "e", "w"),
        coordinate_name(south, "n", "s"),
        coordinate_name(north, "n", "s"),
    )


def save_outputs(image: Image.Image, args: argparse.Namespace) -> None:
    args.output_dir.mkdir(parents=True, exist_ok=True)
    segments = [(args.west, args.east, 0, image.width)]
    if args.split_longitude is not None:
        if not args.west < args.split_longitude < args.east:
            raise ValueError("Split longitude must fall inside the output bounds")
        split_pixel = exact_pixel(
            (args.split_longitude - args.west) / (args.east - args.west) * image.width,
            "split longitude",
        )
        segments = [
            (args.west, args.split_longitude, 0, split_pixel),
            (args.split_longitude, args.east, split_pixel, image.width),
        ]

    for west, east, left, right in segments:
        output_path = args.output_dir / output_name(west, east, args.south, args.north)
        segment = image.crop((left, 0, right, image.height))
        segment.save(output_path, format="WEBP", quality=args.quality, method=6)
        print(f"Wrote {output_path} ({segment.width}x{segment.height})")


def main() -> None:
    args = parse_args()
    if not (-85.05112878 < args.south < args.north < 85.05112878):
        raise ValueError("Latitude bounds must be ordered and inside Web Mercator limits")
    if not (-180 <= args.west < args.east <= 180):
        raise ValueError("Longitude bounds must be ordered inside -180..180")
    if not 0 <= args.quality <= 100:
        raise ValueError("WebP quality must be between 0 and 100")

    elevation, pixels_per_degree = load_elevation(args)
    shade = hillshade(elevation, pixels_per_degree, args.north)
    image = colorize(elevation, shade)
    bounds = (args.west, args.south, args.east, args.north)
    image = add_hydrography(image, args.hydrography_dir, bounds, pixels_per_degree)
    image = reproject_web_mercator(image, args.south, args.north, pixels_per_degree)
    save_outputs(image, args)


if __name__ == "__main__":
    main()
