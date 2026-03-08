#!/usr/bin/env python3
from __future__ import annotations

import re
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parent.parent
ICON_DIR = ROOT / "public" / "block-icons" / "precomputed"
UNUSED_ICON_DIR = ICON_DIR / "unused"

CARPET_IDS = {
    "moss_carpet",
    "pale_moss_carpet",
}

SNOW_LAYER_IDS = {
    "snow",
}

SLAB_IDS = {
    "petrified_oak_slab",
}
PRESSURE_PLATE_IDS = {
    "light_weighted_pressure_plate",
    "heavy_weighted_pressure_plate",
}
PRISMARINE_LEGACY_PATH_IDS = {
    "prismarine",
    "prismarine_slab",
}

PANE_RE = re.compile(r"(?:^glass_pane$|_stained_glass_pane$)")
STAINED_GLASS_RE = re.compile(r"^([a-z_]+)_stained_glass(?:_pane)?$")
WATERLOGGED_RE = re.compile(r"^(?:[a-z_]+_leaves)\[waterlogged=true\]$")

# Mushroom Fields biome tint refs:
# grass: #55C93F, foliage: #2BBB0F, water: #3F76E4
GRASS_TINT = (0x55, 0xC9, 0x3F)
FOLIAGE_TINT = (0x2B, 0xBB, 0x0F)
WATER_TINT = (0x3F, 0x76, 0xE4)
DEFAULT_FOLIAGE_TINT = (0x48, 0xB5, 0x18)
SPRUCE_FOLIAGE_TINT = (0x61, 0x99, 0x61)
BIRCH_FOLIAGE_TINT = (0x80, 0xA7, 0x55)
LILY_PAD_TINT = (0x20, 0x80, 0x30)

DYE_TINTS = {
    "white": (0xF9, 0xFF, 0xFE),
    "orange": (0xF9, 0x80, 0x1D),
    "magenta": (0xC7, 0x4E, 0xBD),
    "light_blue": (0x3A, 0xB3, 0xDA),
    "yellow": (0xFE, 0xD8, 0x3D),
    "lime": (0x80, 0xC7, 0x1F),
    "pink": (0xF3, 0x8B, 0xAA),
    "gray": (0x47, 0x4F, 0x52),
    "light_gray": (0x9D, 0x9D, 0x97),
    "cyan": (0x16, 0x9C, 0x9C),
    "purple": (0x89, 0x32, 0xB8),
    "blue": (0x3C, 0x44, 0xAA),
    "brown": (0x83, 0x54, 0x32),
    "green": (0x5E, 0x7C, 0x16),
    "red": (0xB0, 0x2E, 0x26),
    "black": (0x1D, 0x1D, 0x21),
}

GRASS_TINT_IDS = {
    "grass_block",
    "short_grass",
    "tall_grass",
    "fern",
}
FOLIAGE_TINT_IDS = {
    "oak_leaves",
    "spruce_leaves",
    "birch_leaves",
    "jungle_leaves",
    "acacia_leaves",
    "dark_oak_leaves",
    "pale_oak_leaves",
    "mangrove_leaves",
    "azalea_leaves",
    "flowering_azalea_leaves",
    "vine",
    "vines",
    "sugar_cane",
    "lily_pad",
}
WATERLOGGED_SKIP_TINT_IDS = {
    "cherry_leaves",
    "azalea_leaves",
    "flowering_azalea_leaves",
}
BLOCK_SPECIFIC_FOLIAGE_TINTS = {
    "spruce_leaves": SPRUCE_FOLIAGE_TINT,
    "birch_leaves": BIRCH_FOLIAGE_TINT,
    "dark_oak_leaves": DEFAULT_FOLIAGE_TINT,
    "lily_pad": LILY_PAD_TINT,
}


def block_id(stem: str) -> str:
    return stem.split("[", 1)[0]


def decode_icon_key(stem: str) -> str:
    return (
        stem.replace("__lb__", "[")
        .replace("__rb__", "]")
        .replace("__eq__", "=")
        .replace("__cm__", ",")
        .replace("__cl__", ":")
        .replace("__us__", "__")
    )


def slice_bottom(img: Image.Image, out_height: int) -> Image.Image:
    src = img.convert("RGBA")
    strip = src.crop((0, max(0, 16 - out_height), 16, 16))
    out = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    out.paste(strip, (0, 16 - out_height), strip)
    return out


def slice_center_x(img: Image.Image, out_width: int) -> Image.Image:
    src = img.convert("RGBA")
    left = max(0, (16 - out_width) // 2)
    right = min(16, left + out_width)
    strip = src.crop((left, 0, right, 16))
    out = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    out.paste(strip, (left, 0), strip)
    return out


def compress_x(img: Image.Image, out_width: int) -> Image.Image:
    src = img.convert("RGBA")
    squashed = src.resize((out_width, 16), resample=Image.Resampling.NEAREST)
    out = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    x = max(0, (16 - out_width) // 2)
    out.paste(squashed, (x, 0), squashed)
    return out


def thicken_x(img: Image.Image, radius: int = 1) -> Image.Image:
    src = img.convert("RGBA")
    out = src.copy()
    src_px = src.load()
    out_px = out.load()
    for y in range(src.height):
        for x in range(src.width):
            r, g, b, a = src_px[x, y]
            if a == 0:
                continue
            for dx in range(-radius, radius + 1):
                nx = x + dx
                if nx < 0 or nx >= src.width:
                    continue
                rr, gg, bb, aa = out_px[nx, y]
                if aa >= a:
                    continue
                out_px[nx, y] = (r, g, b, a)
    return out


def recolor_with_tint(
    img: Image.Image,
    tint: tuple[int, int, int],
    *,
    preserve_water_blue: bool = False,
) -> Image.Image:
    src = img.convert("RGBA")
    px = src.load()
    for y in range(src.height):
        for x in range(src.width):
            r, g, b, a = px[x, y]
            if a == 0:
                continue

            if preserve_water_blue and b > g and b > r and b >= 90:
                continue

            intensity = (r + g + b) / (3.0 * 255.0)
            px[x, y] = (
                int(tint[0] * intensity),
                int(tint[1] * intensity),
                int(tint[2] * intensity),
                a,
            )
    return src


def is_mostly_grayscale(img: Image.Image, *, tolerance: int = 8, ratio: float = 0.85) -> bool:
    src = img.convert("RGBA")
    px = src.load()
    total = 0
    grayish = 0
    for y in range(src.height):
        for x in range(src.width):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            total += 1
            if abs(r - g) <= tolerance and abs(g - b) <= tolerance and abs(r - b) <= tolerance:
                grayish += 1
    if total == 0:
        return False
    return (grayish / total) >= ratio


def brighten(img: Image.Image, factor: float) -> Image.Image:
    src = img.convert("RGBA")
    px = src.load()
    for y in range(src.height):
        for x in range(src.width):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            px[x, y] = (
                min(255, int(r * factor)),
                min(255, int(g * factor)),
                min(255, int(b * factor)),
                a,
            )
    return src


def amplify_alpha(img: Image.Image, factor: float) -> Image.Image:
    src = img.convert("RGBA")
    px = src.load()
    for y in range(src.height):
        for x in range(src.width):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            px[x, y] = (r, g, b, min(255, int(a * factor)))
    return src


def normalize_icon_size(img: Image.Image) -> Image.Image:
    src = img.convert("RGBA")
    if src.width == 16 and src.height == 16:
        return src

    # Animated textures are often 16x(N*16); use the first frame.
    if src.width == 16 and src.height > 16:
        return src.crop((0, 0, 16, 16))

    if src.width > 16 and src.height == 16:
        return src.crop((0, 0, 16, 16))

    # Fallback for oversized non-standard sources.
    if src.width >= 16 and src.height >= 16:
        return src.resize((16, 16), resample=Image.Resampling.NEAREST)

    out = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    out.paste(src, (0, 0), src)
    return out


def crop_center(img: Image.Image, out_height: int) -> Image.Image:
    src = img.convert("RGBA")
    if src.height <= out_height:
        return normalize_icon_size(src)
    top = max(0, (src.height - out_height) // 2)
    return src.crop((0, top, min(16, src.width), top + out_height))


def main() -> None:
    if not ICON_DIR.exists():
        print("No precomputed icon dir found; skipping postprocess.")
        return

    carpets = 0
    slabs = 0
    plates = 0
    trapdoors = 0
    panes = 0
    stairs = 0
    buttons = 0
    fences = 0
    fence_gates = 0
    walls = 0
    heads = 0
    stained_tinted = 0
    foliage_tinted = 0
    grass_tinted = 0
    water_tinted = 0
    waterlogged_tinted = 0

    png_files = list(ICON_DIR.glob("*.png"))
    if UNUSED_ICON_DIR.exists():
        png_files.extend(list(UNUSED_ICON_DIR.glob("*.png")))

    for png in png_files:
        decoded_stem = decode_icon_key(png.stem)
        bid = block_id(decoded_stem)
        is_waterlogged_leaf = WATERLOGGED_RE.match(decoded_stem) is not None
        img = Image.open(png).convert("RGBA")

        # Preserve old runtime "object-cover" behavior for prismarine path textures.
        if bid in PRISMARINE_LEGACY_PATH_IDS and img.width == 16 and img.height > 16:
            if bid == "prismarine":
                crop_center(img, 16).save(png)
                continue
            # prismarine_slab old runtime path:
            # centered crop from tall texture to half-height strip, then bottom-align in 16x16 icon.
            strip = crop_center(img, 8)
            out = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
            out.paste(strip, (0, 8), strip)
            out.save(png)
            slabs += 1
            continue

        normalized = normalize_icon_size(img)
        if normalized.size != img.size or normalized.tobytes() != img.tobytes():
            img = normalized
            img.save(png)

        if bid == "chiseled_bookshelf":
            img = img.transpose(Image.Transpose.ROTATE_180)
            img.save(png)

        stained_match = STAINED_GLASS_RE.match(bid)
        if stained_match and is_mostly_grayscale(img):
            dye = stained_match.group(1)
            tint = DYE_TINTS.get(dye)
            if tint is not None:
                img = recolor_with_tint(img, tint)
                img.save(png)
                if not bid.endswith("_stained_glass_pane"):
                    stained_tinted += 1

        if bid in GRASS_TINT_IDS and is_mostly_grayscale(img):
            img = recolor_with_tint(img, GRASS_TINT)
            img.save(png)
            grass_tinted += 1

        if bid in BLOCK_SPECIFIC_FOLIAGE_TINTS and is_mostly_grayscale(img):
            img = recolor_with_tint(img, BLOCK_SPECIFIC_FOLIAGE_TINTS[bid])
            img.save(png)
            foliage_tinted += 1

        if bid in FOLIAGE_TINT_IDS and is_mostly_grayscale(img):
            img = recolor_with_tint(img, FOLIAGE_TINT)
            img.save(png)
            foliage_tinted += 1

        if bid == "water":
            img = recolor_with_tint(img, WATER_TINT)
            img.save(png)
            water_tinted += 1

        if is_waterlogged_leaf and bid not in WATERLOGGED_SKIP_TINT_IDS:
            tint = BLOCK_SPECIFIC_FOLIAGE_TINTS.get(bid, FOLIAGE_TINT)
            img = recolor_with_tint(img, tint, preserve_water_blue=True)
            img.save(png)
            waterlogged_tinted += 1

        if bid == "honey_block":
            img = amplify_alpha(img, 2.0)
            img.save(png)

        if bid.endswith("_carpet") or bid in CARPET_IDS:
            slice_bottom(img, 2).save(png)
            carpets += 1
            continue

        if bid in SNOW_LAYER_IDS:
            slice_bottom(img, 4).save(png)
            carpets += 1
            continue

        if bid.endswith("_slab") or bid in SLAB_IDS:
            slice_bottom(img, 8).save(png)
            slabs += 1
            continue

        if bid.endswith("_pressure_plate") or bid in PRESSURE_PLATE_IDS:
            slice_bottom(img, 2).save(png)
            plates += 1
            continue

        if bid.endswith("_trapdoor"):
            slice_bottom(img, 3).save(png)
            trapdoors += 1
            continue

        if bid.endswith("_button"):
            btn = img.resize((10, 5), resample=Image.Resampling.NEAREST)
            out = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
            out.paste(btn, (3, 10), btn)
            out.save(png)
            buttons += 1
            continue

        if bid.endswith("_stairs"):
            out = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
            lower = img.crop((0, 8, 16, 16))
            step = img.resize((8, 8), resample=Image.Resampling.NEAREST)
            out.paste(lower, (0, 8), lower)
            out.paste(step, (0, 0), step)
            out.save(png)
            stairs += 1
            continue

        if bid.endswith("_fence_gate"):
            compress_x(img, 8).save(png)
            fence_gates += 1
            continue

        if bid.endswith("_fence"):
            compress_x(img, 6).save(png)
            fences += 1
            continue

        if (
            bid.endswith("_wall")
            and not bid.endswith("_wall_sign")
            and not bid.endswith("_wall_hanging_sign")
            and not bid.endswith("_wall_head")
            and not bid.endswith("_wall_skull")
            and bid not in {"wall_torch", "soul_wall_torch"}
        ):
            compress_x(img, 7).save(png)
            walls += 1
            continue

        if bid.endswith("_head") or bid.endswith("_skull"):
            head = img.resize((12, 12), resample=Image.Resampling.NEAREST)
            out = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
            out.paste(head, (2, 4), head)
            out.save(png)
            heads += 1
            continue

        if PANE_RE.search(bid):
            pane_img = compress_x(img, 5)
            pane_alpha_boost = 3.0 if bid == "glass_pane" else 2.1
            pane_img = amplify_alpha(pane_img, pane_alpha_boost)
            if STAINED_GLASS_RE.match(bid):
                pane_img = brighten(pane_img, 1.2)
            elif bid == "glass_pane":
                pane_img = thicken_x(pane_img, radius=1)
                pane_img = brighten(pane_img, 1.25)
            pane_img.save(png)
            panes += 1
            if STAINED_GLASS_RE.match(bid):
                stained_tinted += 1
            continue

    print(
        "Postprocessed icons: "
        f"carpets={carpets}, "
        f"slabs={slabs}, "
        f"pressure_plates={plates}, "
        f"trapdoors={trapdoors}, "
        f"stairs={stairs}, "
        f"buttons={buttons}, "
        f"fences={fences}, "
        f"fence_gates={fence_gates}, "
        f"walls={walls}, "
        f"heads={heads}, "
        f"panes={panes}, "
        f"stained_tinted={stained_tinted}, "
        f"grass_tinted={grass_tinted}, "
        f"foliage_tinted={foliage_tinted}, "
        f"water_tinted={water_tinted}, "
        f"waterlogged_tinted={waterlogged_tinted}"
    )


if __name__ == "__main__":
    main()
