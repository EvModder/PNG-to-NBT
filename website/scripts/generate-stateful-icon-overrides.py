#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
from typing import Iterable

from PIL import Image


ROOT = Path(__file__).resolve().parent.parent
SOURCE_ROOT = ROOT / "assets" / "block-icons-source"
BLOCK_ROOT = SOURCE_ROOT / "blocks"
CUSTOM_ROOT = SOURCE_ROOT / "custom"

# Mushroom Fields / default map water tint
WATER_TINT = (63, 118, 228)

AXIS_X_OVERRIDES = {
    "spruce_log[axis=x]": "spruce_log",
    "jungle_log[axis=x]": "jungle_log",
    "cherry_log[axis=x]": "cherry_log",
    "pale_oak_log[axis=x]": "pale_oak_log",
}

DOWN_FACE_OVERRIDES = {
    "glow_lichen[down=true]": ("glow_lichen", ["top", "side", "bottom"]),
    "resin_clump[down=true]": ("resin_clump", ["top", "side", "bottom"]),
}

WATERLOGGED_OVERRIDES = {
    "oak_leaves[waterlogged=true]": "oak_leaves",
    "spruce_leaves[waterlogged=true]": "spruce_leaves",
    "birch_leaves[waterlogged=true]": "birch_leaves",
    "jungle_leaves[waterlogged=true]": "jungle_leaves",
    "acacia_leaves[waterlogged=true]": "acacia_leaves",
    "dark_oak_leaves[waterlogged=true]": "dark_oak_leaves",
    "cherry_leaves[waterlogged=true]": "cherry_leaves",
    "pale_oak_leaves[waterlogged=true]": "pale_oak_leaves",
    "mangrove_leaves[waterlogged=true]": "mangrove_leaves",
    "azalea_leaves[waterlogged=true]": "azalea_leaves",
    "flowering_azalea_leaves[waterlogged=true]": "flowering_azalea_leaves",
}


def load_face(block_id: str, order: Iterable[str]) -> Image.Image | None:
    for face in order:
        candidate = BLOCK_ROOT / block_id / f"{face}.png"
        if candidate.exists():
            return Image.open(candidate).convert("RGBA")
    return None


def write_override(name: str, img: Image.Image) -> None:
    CUSTOM_ROOT.mkdir(parents=True, exist_ok=True)
    out_path = CUSTOM_ROOT / f"{name}.png"
    img.save(out_path)


def tint_water_pixel(pixel: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
    wr, wg, wb, wa = pixel
    # Preserve water texture detail while applying a stable map-style water tint.
    intensity = (wr + wg + wb) / (3.0 * 255.0)
    tr = int(WATER_TINT[0] * intensity)
    tg = int(WATER_TINT[1] * intensity)
    tb = int(WATER_TINT[2] * intensity)
    return tr, tg, tb, max(170, wa)


def generate_axis_x_overrides() -> int:
    written = 0
    for entry, block_id in AXIS_X_OVERRIDES.items():
        img = load_face(block_id, ["side", "top", "bottom"])
        if img is None:
            continue
        write_override(entry, img)
        written += 1
    return written


def generate_down_face_overrides() -> int:
    written = 0
    for entry, (block_id, order) in DOWN_FACE_OVERRIDES.items():
        img = load_face(block_id, order)
        if img is None:
            continue
        write_override(entry, img)
        written += 1
    return written


def generate_waterlogged_overrides() -> int:
    water = load_face("water", ["side", "top", "bottom"])
    if water is None:
        return 0

    water_px = water.load()
    written = 0

    for entry, block_id in WATERLOGGED_OVERRIDES.items():
        base = load_face(block_id, ["side", "top", "bottom"])
        if base is None:
            continue

        out = base.copy()
        out_px = out.load()
        for y in range(out.height):
            for x in range(out.width):
                r, g, b, a = out_px[x, y]
                if a != 0:
                    continue
                out_px[x, y] = tint_water_pixel(water_px[x % water.width, y % water.height])

        write_override(entry, out)
        written += 1

    return written


def main() -> None:
    axis_count = generate_axis_x_overrides()
    down_count = generate_down_face_overrides()
    water_count = generate_waterlogged_overrides()
    total = axis_count + down_count + water_count
    print(f"Generated stateful icon overrides: {total}")
    print(f"  axis=x overrides: {axis_count}")
    print(f"  down=true overrides: {down_count}")
    print(f"  waterlogged overrides: {water_count}")


if __name__ == "__main__":
    main()
