#!/usr/bin/env python3
from __future__ import annotations

from io import BytesIO
from pathlib import Path
import ssl
from urllib.request import urlopen

from PIL import Image, ImageEnhance


ROOT = Path(__file__).resolve().parent.parent
PRIMARY_ROOT = ROOT / "public" / "block-icons" / "primary"
UNUSED_ROOT = ROOT / "public" / "block-icons" / "unused"
ATLAS_CELL_SIZE = 16
BLOCK_TEXTURE_HOST = "https://assets.mcasset.cloud/latest/assets/minecraft/textures/block"
ITEM_TEXTURE_HOST = "https://assets.mcasset.cloud/latest/assets/minecraft/textures/item"
ENTITY_SHULKER_HOST = "https://assets.mcasset.cloud/latest/assets/minecraft/textures/entity/shulker"
SSL_CONTEXT = ssl._create_unverified_context()

SHULKER_BLOCK_IDS = [
    "shulker_box",
    "white_shulker_box",
    "orange_shulker_box",
    "magenta_shulker_box",
    "light_blue_shulker_box",
    "yellow_shulker_box",
    "lime_shulker_box",
    "pink_shulker_box",
    "gray_shulker_box",
    "light_gray_shulker_box",
    "cyan_shulker_box",
    "purple_shulker_box",
    "blue_shulker_box",
    "brown_shulker_box",
    "green_shulker_box",
    "red_shulker_box",
    "black_shulker_box",
]
HANGING_SIGN_BLOCK_IDS = [
    "acacia_hanging_sign",
    "acacia_wall_hanging_sign",
    "bamboo_hanging_sign",
    "bamboo_wall_hanging_sign",
    "birch_hanging_sign",
    "birch_wall_hanging_sign",
    "cherry_hanging_sign",
    "cherry_wall_hanging_sign",
    "crimson_hanging_sign",
    "crimson_wall_hanging_sign",
    "dark_oak_hanging_sign",
    "dark_oak_wall_hanging_sign",
    "jungle_hanging_sign",
    "jungle_wall_hanging_sign",
    "mangrove_hanging_sign",
    "mangrove_wall_hanging_sign",
    "oak_hanging_sign",
    "oak_wall_hanging_sign",
    "pale_oak_hanging_sign",
    "pale_oak_wall_hanging_sign",
    "spruce_hanging_sign",
    "spruce_wall_hanging_sign",
    "warped_hanging_sign",
    "warped_wall_hanging_sign",
]
COMMAND_BLOCK_SIDE_TEXTURES = {
    "command_block": "https://assets.mcasset.cloud/latest/assets/minecraft/textures/block/command_block_side.png",
    "chain_command_block": "https://assets.mcasset.cloud/latest/assets/minecraft/textures/block/chain_command_block_side.png",
    "repeating_command_block": "https://assets.mcasset.cloud/latest/assets/minecraft/textures/block/repeating_command_block_side.png",
}
SPECIAL_BLOCK_TEXTURES = {
    "jigsaw": "https://assets.mcasset.cloud/latest/assets/minecraft/textures/block/jigsaw_side.png",
}
END_PORTAL_TEXTURE = "https://assets.mcasset.cloud/latest/assets/minecraft/textures/environment/end_sky.png"
END_PORTAL_FRAME_TEXTURE = "https://assets.mcasset.cloud/latest/assets/minecraft/textures/block/end_portal_frame_side.png"


try:
    RESAMPLE_NEAREST = Image.Resampling.NEAREST
except AttributeError:
    RESAMPLE_NEAREST = Image.NEAREST


def fetch_block_texture(block_id: str) -> Image.Image:
    with urlopen(f"{BLOCK_TEXTURE_HOST}/{block_id}.png", context=SSL_CONTEXT) as response:
        return Image.open(BytesIO(response.read())).convert("RGBA")


def fetch_image(url: str) -> Image.Image:
    with urlopen(url, context=SSL_CONTEXT) as response:
        return Image.open(BytesIO(response.read())).convert("RGBA")


def first_square_frame(image: Image.Image) -> Image.Image:
    frame_size = min(image.width, image.height)
    return image.crop((0, 0, frame_size, frame_size))


def shulker_entity_url(block_id: str) -> str:
    if block_id == "shulker_box":
        return f"{ENTITY_SHULKER_HOST}/shulker.png"
    color = block_id.removesuffix("_shulker_box")
    return f"{ENTITY_SHULKER_HOST}/shulker_{color}.png"


def hanging_sign_item_url(block_id: str) -> str:
    return f"{ITEM_TEXTURE_HOST}/{block_id.replace('_wall_hanging_sign', '_hanging_sign')}.png"


def render_shulker_icon(texture: Image.Image) -> Image.Image:
    # The closed shulker side lives in the far-right two-column strip of the
    # entity texture. The base 16x16 crop already contains:
    # - y=16..24: the full upper half
    # - y=24..32: the upper corner insets of the lower half
    # The remaining lower-half pixels come from:
    # - y=40..48, shifted up by half a cell
    # - y=48..56, shifted into the final bottom quarter
    base = texture.crop((48, 16, 64, 32))
    lower_overlay = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    lower_overlay.paste(texture.crop((48, 40, 64, 48)), (0, 4))
    bottom_overlay = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    bottom_overlay.paste(texture.crop((48, 48, 64, 56)), (0, 12))
    return Image.alpha_composite(
        Image.alpha_composite(base, lower_overlay),
        bottom_overlay,
    ).resize(
        (ATLAS_CELL_SIZE, ATLAS_CELL_SIZE),
        RESAMPLE_NEAREST,
    )


def render_command_block_icon(texture: Image.Image) -> Image.Image:
    return first_square_frame(texture).resize((ATLAS_CELL_SIZE, ATLAS_CELL_SIZE), RESAMPLE_NEAREST)


def render_end_portal_icon(texture: Image.Image) -> Image.Image:
    portal = texture.resize((ATLAS_CELL_SIZE, ATLAS_CELL_SIZE), RESAMPLE_NEAREST)
    r, g, b, a = portal.split()
    rgb = Image.merge("RGB", (r, g, b))
    rgb = ImageEnhance.Brightness(rgb).enhance(0.35)
    return Image.merge("RGBA", (*rgb.split(), a))


def render_end_portal_frame_icon(texture: Image.Image) -> Image.Image:
    return texture.resize((ATLAS_CELL_SIZE, ATLAS_CELL_SIZE), RESAMPLE_NEAREST)


def main() -> int:
    PRIMARY_ROOT.mkdir(parents=True, exist_ok=True)
    UNUSED_ROOT.mkdir(parents=True, exist_ok=True)
    for block_id in SHULKER_BLOCK_IDS:
        texture = fetch_image(shulker_entity_url(block_id))
        icon = render_shulker_icon(texture)
        icon.save(UNUSED_ROOT / f"{block_id}.png", optimize=True)
        if block_id == "purple_shulker_box":
            icon.save(PRIMARY_ROOT / f"{block_id}.png", optimize=True)
    for block_id in HANGING_SIGN_BLOCK_IDS:
        icon = fetch_image(hanging_sign_item_url(block_id)).resize((ATLAS_CELL_SIZE, ATLAS_CELL_SIZE), RESAMPLE_NEAREST)
        icon.save(UNUSED_ROOT / f"{block_id}.png", optimize=True)
    for block_id, texture_url in COMMAND_BLOCK_SIDE_TEXTURES.items():
        render_command_block_icon(fetch_image(texture_url)).save(UNUSED_ROOT / f"{block_id}.png", optimize=True)
    for block_id, texture_url in SPECIAL_BLOCK_TEXTURES.items():
        render_command_block_icon(fetch_image(texture_url)).save(UNUSED_ROOT / f"{block_id}.png", optimize=True)
    render_end_portal_icon(fetch_image(END_PORTAL_TEXTURE)).save(UNUSED_ROOT / "end_portal.png", optimize=True)
    render_end_portal_frame_icon(fetch_image(END_PORTAL_FRAME_TEXTURE)).save(
        UNUSED_ROOT / "end_portal_frame.png",
        optimize=True,
    )
    print(
        f"Rendered {len(SHULKER_BLOCK_IDS)} shulker icons, {len(HANGING_SIGN_BLOCK_IDS)} hanging sign icons, "
        f"and portal overrides into {UNUSED_ROOT.relative_to(ROOT)}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
