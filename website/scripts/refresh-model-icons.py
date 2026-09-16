#!/usr/bin/env python3
"""Refresh selected catalog icons from a released Minecraft client jar (Pillow required).

Usage: python3 scripts/refresh-model-icons.py CLIENT.jar BLOCK_ID [BLOCK_ID ...]
Then run: python3 scripts/build-icon-atlases.py
Uses vanilla UVs/model bounds for flat icons, not inventory perspective rendering.
Run after the legacy icon postprocessor, which approximates block geometry.
"""
import argparse
from functools import cache
from io import BytesIO
import json
import math
from pathlib import Path
import re
import zipfile

from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parents[1]
NEAREST = Image.Resampling.NEAREST
# Match the Mushroom Fields grass tint used by the legacy icon postprocessor.
GRASS_TINT = (0x55, 0xC9, 0x3F, 255)
WATER_TINT = (0x3F, 0x76, 0xE4)


class Assets:
    def __init__(self, jar):
        self.jar = jar

    def json(self, kind, name):
        return json.loads(self.jar.read(f"assets/minecraft/{kind}/{name.removeprefix('minecraft:')}.json"))

    @cache
    def texture(self, name):
        name = name.removeprefix("minecraft:")
        name = name.removeprefix("textures/").removesuffix(".png")
        return Image.open(BytesIO(self.jar.read(f"assets/minecraft/textures/{name}.png"))).convert("RGBA")

    @cache
    def model(self, name):
        model = self.json("models", name)
        parent = model.get("parent", "")
        if parent and parent not in {"builtin/generated", "minecraft:builtin/generated"}:
            base = self.model(parent)
            model = {**base, **model, "textures": {**base.get("textures", {}), **model.get("textures", {})}}
        return model

    def render(self, name, side="south", tint=None, height=16):
        model = self.model(name)
        textures = model.get("textures", {})

        def texture(ref):
            while ref.startswith("#") or ref in textures:
                ref = textures[ref.removeprefix("#")]
            return self.texture(ref)

        if "layer0" in textures:
            img = texture("#layer0")
            img = img.crop((0, 0, img.width, img.width)).resize((16, 16), NEAREST)
            return ImageChops.multiply(img, Image.new("RGBA", img.size, tint)) if tint else img
        out = Image.new("RGBA", (16, height))
        horizontal, vertical, depth = (0, 2, 1) if side == "up" else (2, 1, 0) if side == "east" else (0, 1, 2)
        for element in sorted(model["elements"], key=lambda e: e["to"][depth], reverse=side == "north"):
            face = element["faces"].get(side)
            if not face:
                continue
            start, end = element["from"], element["to"]
            left, right = start[horizontal], end[horizontal]
            rotation = element.get("rotation")
            if rotation:
                if rotation["axis"] != "y":
                    raise ValueError(f"Unsupported rotation in {name}: {rotation}")
                # Orthographic projection of the visible face (lantern handle/flower cross).
                center = rotation["origin"][horizontal]
                scale = 1 if rotation.get("rescale") else math.cos(math.radians(rotation["angle"]))
                left, right = (center + (x - center) * scale for x in (left, right))
            box = tuple(round(v) for v in (left, height - end[vertical], right, height - start[vertical]))
            width, face_height = box[2] - box[0], box[3] - box[1]
            if width <= 0 or face_height <= 0:
                continue
            uv = face.get("uv", [start[horizontal], 16 - end[1], end[horizontal], 16 - start[1]])
            src = texture(face["texture"])
            u1, v1, u2, v2 = [round(v * src.width / 16) for v in uv]
            tile = src.crop((min(u1, u2), min(v1, v2), max(u1, u2), max(v1, v2)))
            if u1 > u2:
                tile = tile.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
            if v1 > v2:
                tile = tile.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
            tile = tile.rotate(-face.get("rotation", 0), expand=True).resize((width, face_height), NEAREST)
            if tint and face.get("tintindex") == 0:
                tile = ImageChops.multiply(tile, Image.new("RGBA", tile.size, tint))
            out.alpha_composite(tile, box[:2])
        if not out.getbbox():
            raise ValueError(f"Empty icon: {name}")
        return out

    def special(self, model):
        kind = model["type"].removeprefix("minecraft:")
        if kind in {"head", "player_head"}:
            head = model.get("kind", "player")
            texture = {
                "player": "player/wide/steve", "zombie": "zombie/zombie",
                "skeleton": "skeleton/skeleton", "wither_skeleton": "skeleton/wither_skeleton",
                "creeper": "creeper/creeper", "piglin": "piglin/piglin", "dragon": "enderdragon/dragon",
            }[head]
            src = self.texture("entity/" + texture)
            # Front-facing UVs from SkullModel, AbstractPiglinModel and DragonHeadModel.
            if head == "piglin":
                out = Image.new("RGBA", (16, 8))
                out.alpha_composite(src.crop((43, 10, 44, 15)).rotate(-30, expand=True), (0, 2))
                out.alpha_composite(src.crop((55, 10, 56, 15)).rotate(30, expand=True), (12, 2))
                for uv, pos in [((8, 8, 18, 16), (3, 0)), ((32, 2, 36, 6), (6, 4)),
                                ((3, 1, 4, 3), (5, 6)), ((3, 5, 4, 7), (10, 6))]:
                    out.alpha_composite(src.crop(uv), pos)
            elif head == "dragon":
                out = Image.new("RGBA", (16, 20))
                for uv, pos in [((6, 6, 8, 10), (3, 0)), ((6, 6, 8, 10), (11, 0)),
                                ((128, 46, 144, 62), (0, 4)), ((192, 60, 204, 65), (2, 11)),
                                ((116, 4, 118, 6), (3, 9)), ((116, 4, 118, 6), (11, 9)),
                                ((192, 81, 204, 85), (2, 16))]:
                    out.alpha_composite(src.crop(uv), pos)
            else:
                out = src.crop((8, 8, 16, 16))
                if head == "player":
                    out.alpha_composite(src.crop((40, 8, 48, 16)))
            size = 16 if head in {"piglin", "dragon"} else 12
            scale = min(size / out.width, size / out.height)
            out = out.resize((round(out.width * scale), round(out.height * scale)), NEAREST)
            icon = Image.new("RGBA", (16, 16))
            # Raise heads one pixel, except the full-height dragon whose horns would clip.
            icon.alpha_composite(out, ((16 - out.width) // 2, max(0, 15 - out.height)))
            return icon
        if kind == "decorated_pot":
            base = self.texture("entity/decorated_pot/decorated_pot_base")
            side = self.texture("entity/decorated_pot/decorated_pot_side")
            out = Image.new("RGBA", (16, 20))
            # DecoratedPotRenderer: 14x16 body, 8x3 rim, 6x1 neck; flipped model Y.
            for src, uv, pos in [
                (side, (1, 0, 15, 16), (1, 4)),
                (base, (8, 8, 16, 11), (4, 0)),
                (base, (6, 11, 12, 12), (5, 3)),
            ]:
                out.alpha_composite(src.crop(uv).transpose(Image.Transpose.FLIP_TOP_BOTTOM), pos)
            icon = Image.new("RGBA", (16, 16))
            icon.alpha_composite(out.resize((13, 16), NEAREST), (1, 0))
            return icon
        if kind == "chest":
            src = self.texture("entity/chest/" + model["texture"].removeprefix("minecraft:"))
            out = Image.new("RGBA", (16, 16))
            # ChestModel: base, lid, lock; south faces, with model Y pointing up.
            for uv, pos in [((42, 33, 56, 43), (1, 6)), ((42, 14, 56, 19), (1, 2)), ((4, 1, 6, 5), (7, 5))]:
                out.alpha_composite(src.crop(uv).transpose(Image.Transpose.FLIP_TOP_BOTTOM), pos)
            return out
        if kind == "copper_golem_statue":
            src = self.texture(model["texture"])
            out = Image.new("RGBA", (16, 24))
            # CopperGolemModel standing pose: north-facing skin UVs, original proportions.
            for uv, pos in [
                ((4, 31, 8, 36), (4, 19)), ((20, 31, 24, 36), (8, 19)),
                ((6, 21, 14, 27), (4, 13)), ((40, 20, 43, 30), (1, 12)),
                ((54, 20, 57, 30), (12, 12)), ((10, 10, 18, 15), (4, 8)),
                ((58, 2, 60, 5), (7, 11)), ((39, 10, 41, 14), (7, 4)),
                ((41, 4, 45, 8), (6, 0)),
            ]:
                out.alpha_composite(src.crop(uv), pos)
            icon = Image.new("RGBA", (16, 16))
            icon.alpha_composite(out.resize((11, 16), NEAREST), (2, 0))
            return icon
        raise ValueError(f"Unsupported special model: {kind}")

    def icon(self, block):
        if block == "calibrated_sculk_sensor":
            # Its crystal reaches Y=20; fit the whole model rather than clipping its tip.
            icon = Image.new("RGBA", (16, 16))
            model = self.render("block/calibrated_sculk_sensor_inactive", height=20)
            icon.alpha_composite(model.resize((13, 16), NEAREST), (1, 0))
            return icon
        if block == "chorus_flower[age=5]":
            return self.texture("block/chorus_flower_dead")
        if block == "chorus_plant":
            # Show the eight-pixel core with vertical connections, for the icon only.
            icon = Image.new("RGBA", (16, 16))
            icon.alpha_composite(self.texture("block/chorus_plant").crop((4, 0, 12, 16)), (4, 0))
            return icon
        if block in {"hopper", "cauldron"}:
            return self.render(f"block/{block}")
        if block == "heavy_core":
            icon = Image.new("RGBA", (16, 16))
            icon.alpha_composite(self.render("block/heavy_core"), (0, -1))
            return icon
        if block == "grindstone[face=floor]":
            return self.render("block/grindstone", "east")
        if block == "anvil":
            # Remove interior pixels, preserving the base rim and a symmetric stem.
            source = self.render("block/anvil", "east")
            icon = Image.new("RGBA", (16, 16))
            rows = [y for y in range(16) if y not in (2, 8)]
            columns = [x for x in range(16) if x not in (7, 8)]
            for y, source_y in enumerate(rows, 1):
                for x, source_x in enumerate(columns, 1):
                    icon.putpixel((x, y), source.getpixel((source_x, source_y)))
            return icon
        if block == "sniffer_egg":
            return self.render("block/sniffer_egg_not_cracked", "north")
        if block == "dried_ghast":
            return self.render("block/dried_ghast_hydration_0", "north")
        if block == "shelf_mushroom":
            # Show the cap above its front edge; edge-on it is only three pixels tall.
            top = self.render("block/shelf_mushroom_stage0", "up")
            edge = self.render("block/shelf_mushroom_stage0", "north")
            top, edge = top.crop(top.getbbox()), edge.crop(edge.getbbox())
            icon = Image.new("RGBA", (16, 16))
            y = (16 - top.height - edge.height) // 2
            icon.alpha_composite(top, ((16 - top.width) // 2, y))
            icon.alpha_composite(edge, ((16 - edge.width) // 2, y + top.height))
            return icon.transpose(Image.Transpose.ROTATE_90)
        if block == "end_gateway":
            # Shader-rendered block with no item model; use its vanilla portal texture.
            return self.texture("entity/end_portal/end_portal")
        if block == "wheat[age=7]":
            return self.render("block/wheat_stage7")
        if block in {"piston[facing=up]", "sticky_piston[facing=up]"}:
            suffix = "_sticky" if block.startswith("sticky_") else ""
            return self.texture(f"block/piston_top{suffix}")
        block, _, properties = block.partition("[")
        if block.endswith("_poplar_leaves"):
            # Poplar foliage is already colored, unlike biome-tinted ordinary leaves.
            icon = self.texture(f"block/{block}").copy()
            if "waterlogged=true" in properties:
                water = self.texture("block/water_still")
                for y in range(16):
                    for x in range(16):
                        if icon.getpixel((x, y))[3] == 0:
                            r, g, b, a = water.getpixel((x, y))
                            intensity = (r + g + b) / (3 * 255)
                            icon.putpixel((x, y), (*[int(c * intensity) for c in WATER_TINT], max(170, a)))
            return icon
        if block.endswith("_button"):
            # Match the existing buttons' enlarged, readable 10x5 facade.
            texture = self.model(f"block/{block}_inventory")["textures"]["texture"]
            icon = Image.new("RGBA", (16, 16))
            icon.alpha_composite(self.texture(texture).resize((10, 5), NEAREST), (3, 10))
            return icon
        if block.endswith("_log") or block in {"bamboo_block", "stripped_bamboo_block"}:
            suffix = "" if "axis=x" in properties or "axis=z" in properties else "_top"
            return self.texture(f"block/{block}{suffix}")
        if block in {"sulfur_spike", "pointed_dripstone"}:
            # Inventory sprites hang downward; map-art placements use the default upright tip.
            return self.texture(f"block/{block}_up_tip")
        if block.endswith(("_wall", "_fence")):
            return self.render(f"block/{block}_post")
        item = self.json("items", block)["model"]
        while "fallback" in item:
            item = item["fallback"]
        if item["type"] == "minecraft:special":
            return self.special(item["model"])
        if item["type"] != "minecraft:model":
            raise ValueError(f"Unsupported item model: {block}: {item}")
        tint = GRASS_TINT if item.get("tints", [{}])[0].get("type") == "minecraft:grass" else None
        icon = self.render(item["model"], tint=tint)
        if block.endswith("_pressure_plate"):
            # Show the south edge of the top surface above the genuine one-pixel side.
            surface = self.texture(self.model(item["model"])["textures"]["texture"])
            icon.alpha_composite(surface.crop((1, 14, 15, 15)), (1, 14))
        if block.endswith("_stairs"):
            return icon.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
        if block.endswith("_fence_gate"):
            # The model occupies Y=5..16. Center its 11-pixel silhouette in the icon cell.
            centered = Image.new("RGBA", (16, 16))
            centered.alpha_composite(icon, (0, 2))
            return centered
        return icon


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("jar", type=Path)
    parser.add_argument("blocks", nargs="+")
    args = parser.parse_args()
    primary = (ROOT / "src/data/mapColors.ts").read_text().split("export const BASE_COLORS:", 1)[1]
    excluded = (ROOT / "src/data/mapColorsExcluded.ts").read_text().split("const EXCLUDED_BY_ID:", 1)[1]
    primary = set(re.findall(r'"([a-z0-9_]+(?:\[[^"\]]+\])?)"', primary))
    excluded = set(re.findall(r'"([a-z0-9_]+(?:\[[^"\]]+\])?)"', excluded))
    with zipfile.ZipFile(args.jar) as jar:
        assets = Assets(jar)
        # Resolve everything before writing, so unsupported models cannot leave a partial refresh.
        icons = {}
        for block in args.blocks:
            if block not in primary | excluded:
                raise ValueError(f"Not a catalog block: {block}")
            icons[block] = assets.icon(block)
        for block, icon in icons.items():
            group = "primary" if block in primary else "unused"
            key = block.replace("__", "__us__")
            for char, token in {"[": "__lb__", "]": "__rb__", "=": "__eq__", ",": "__cm__", ":": "__cl__"}.items():
                key = key.replace(char, token)
            icon.save(ROOT / f"public/block-icons/{group}/{key}.png")
    print(f"Refreshed {len(icons)} icons from {args.jar}")


if __name__ == "__main__":
    main()
