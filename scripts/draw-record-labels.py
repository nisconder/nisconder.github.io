"""Pack the approved portrait-and-mark artwork into the turntable's WebP sheets."""
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "src/assets"


def build():
    prints = json.loads((ROOT / "src/data/record-prints.json").read_text(encoding="utf-8"))
    labels = []
    for name in prints:
        with Image.open(ASSETS / "record-prints" / f"{name}.webp") as artwork:
            if artwork.width != artwork.height:
                raise ValueError(f"{name} must be square to fit the record center")
            labels.append(artwork.convert("RGB"))
    for name, size in (("record-labels.webp", 88), ("record-labels-hd.webp", 176)):
        atlas = Image.new("RGB", (size, size * len(labels)))
        for index, tile in enumerate(labels):
            atlas.paste(tile.resize((size, size), Image.Resampling.LANCZOS), (0, index * size))
        atlas.save(ASSETS / name, quality=90, method=6)


if __name__ == "__main__":
    build()
