"""Build the record center labels from the site avatar and the masthead mark."""
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps

ROOT = Path(__file__).resolve().parents[1]
SIZE = 352
GREEN = "#1e6552"
PLUM = "#685677"


def site_labels():
    with Image.open(ROOT / "source/img/nisconder-avatar.png") as avatar:
        portrait = ImageOps.fit(avatar.convert("RGB"), (SIZE, SIZE), method=Image.Resampling.LANCZOS)
    mark = Image.new("RGB", (SIZE, SIZE), "#e5f0ea")
    draw = ImageDraw.Draw(mark)
    # The two squares have the same proportions, stacking order and inks as SiteHeader.
    draw.rectangle((67, 79, 203, 215), fill=GREEN)
    draw.rectangle((149, 137, 285, 273), fill=PLUM)
    return {
        "nisconder-avatar": portrait,
        "nisconder-mark": mark,
    }


if __name__ == "__main__":
    labels = site_labels()
    for name, size in (("record-labels.webp", 88), ("record-labels-hd.webp", 176)):
        atlas = Image.new("RGB", (size, size * len(labels)))
        for index, tile in enumerate(labels.values()):
            atlas.paste(tile.resize((size, size), Image.Resampling.LANCZOS), (0, index * size))
        atlas.save(ROOT / "src/assets" / name, quality=87, method=6)
    (ROOT / "src/data/record-prints.json").write_text(json.dumps(list(labels)) + "\n", encoding="utf-8")
