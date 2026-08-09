#!/usr/bin/env python3
"""Crop a global Natural Earth raster and reproject it for MapLibre."""

from __future__ import annotations

import argparse
import math
from pathlib import Path

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = 250_000_000


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Crop a 360-by-180-degree Natural Earth raster and vertically "
            "reproject the result to Web Mercator."
        )
    )
    parser.add_argument("source", type=Path, help="Global Natural Earth TIFF")
    parser.add_argument("output", type=Path, help="Output WebP path")
    parser.add_argument("--west", type=float, required=True)
    parser.add_argument("--south", type=float, required=True)
    parser.add_argument("--east", type=float, required=True)
    parser.add_argument("--north", type=float, required=True)
    parser.add_argument("--quality", type=int, default=92, help="WebP quality (default: 92)")
    return parser.parse_args()


def mercator_y(latitude: float) -> float:
    return math.asinh(math.tan(math.radians(latitude)))


def inverse_mercator_y(value: np.ndarray) -> np.ndarray:
    return np.degrees(np.arctan(np.sinh(value)))


def pixel_edge(value: float, *, label: str) -> int:
    rounded = round(value)
    if not math.isclose(value, rounded, abs_tol=1e-7):
        raise ValueError(f"{label} does not fall on a source pixel edge: {value}")
    return rounded


def main() -> None:
    args = parse_args()
    if not (-85.05112878 < args.south < args.north < 85.05112878):
        raise ValueError("Latitude bounds must be ordered and inside Web Mercator limits")
    if not (-180 <= args.west < args.east <= 180):
        raise ValueError("Longitude bounds must be ordered inside -180..180")
    if not (0 <= args.quality <= 100):
        raise ValueError("WebP quality must be between 0 and 100")

    with Image.open(args.source) as source:
        pixels_per_degree_x = source.width / 360
        pixels_per_degree_y = source.height / 180
        if not math.isclose(pixels_per_degree_x, pixels_per_degree_y):
            raise ValueError("Expected equally spaced longitude and latitude pixels")

        pixels_per_degree = pixels_per_degree_x
        left = pixel_edge((args.west + 180) * pixels_per_degree, label="west")
        right = pixel_edge((args.east + 180) * pixels_per_degree, label="east")
        top = pixel_edge((90 - args.north) * pixels_per_degree, label="north")
        bottom = pixel_edge((90 - args.south) * pixels_per_degree, label="south")
        cropped = source.crop((left, top, right, bottom)).convert("RGB")

    north_y = mercator_y(args.north)
    south_y = mercator_y(args.south)
    target_height = round(
        (north_y - south_y) / math.radians(1 / pixels_per_degree)
    )

    target_y = north_y - (
        (np.arange(target_height, dtype=np.float64) + 0.5)
        / target_height
        * (north_y - south_y)
    )
    target_latitudes = inverse_mercator_y(target_y)
    source_rows = (args.north - target_latitudes) * pixels_per_degree - 0.5
    source_rows = np.clip(source_rows, 0, cropped.height - 1)
    row_before = np.floor(source_rows).astype(np.int32)
    row_after = np.minimum(row_before + 1, cropped.height - 1)
    row_weight = (source_rows - row_before)[:, np.newaxis, np.newaxis]

    source_pixels = np.asarray(cropped, dtype=np.float32)
    target_pixels = (
        source_pixels[row_before] * (1 - row_weight)
        + source_pixels[row_after] * row_weight
    )
    output = Image.fromarray(np.rint(target_pixels).astype(np.uint8), mode="RGB")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    output.save(args.output, format="WEBP", quality=args.quality, method=6)

    print(
        f"Wrote {args.output} ({output.width}x{output.height}) from "
        f"source pixels {right - left}x{bottom - top}+{left}+{top}"
    )


if __name__ == "__main__":
    main()
