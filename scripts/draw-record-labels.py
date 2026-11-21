"""Make the center labels from Nisconder's own avatar, mark, project and series."""
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[1]
SIZE = 352
GREEN = "#1e6552"
PLUM = "#685677"


def word_label(top, bottom, paper, ink):
    label = Image.new("RGB", (SIZE, SIZE), paper)
    draw = ImageDraw.Draw(label)
    for word, center in ((top, 0.34), (bottom, 0.67)):
        font = ImageFont.load_default(size=92)
        while draw.textlength(word, font=font) > SIZE * 0.74:
            font = ImageFont.load_default(size=font.size - 1)
        draw.text((SIZE / 2, SIZE * center), word, fill=ink, font=font, anchor="mm",
                  stroke_width=1, stroke_fill=ink)
    return label


def site_labels():
    with Image.open(ROOT / "source/img/nisconder-avatar.png") as avatar:
        portrait = ImageOps.fit(avatar.convert("RGB"), (SIZE, SIZE), method=Image.Resampling.LANCZOS)
    mark = Image.new("RGB", (SIZE, SIZE), "#e5f0ea")
    draw = ImageDraw.Draw(mark)
    # The two squares have the same proportions, stacking order and inks as SiteHeader.
    draw.rectangle((67, 79, 203, 215), fill=GREEN)
    draw.rectangle((149, 137, 285, 273), fill=PLUM)
    series = (ROOT / "source/_series/ics-8086.md").read_text(encoding="utf-8")
    title = next(line for line in series.splitlines() if line.startswith("title:"))
    course, machine = (piece for piece in title.split() if piece.isascii() and piece != "title:")
    projects = json.loads((ROOT / "src/data/github-repositories.json").read_text(encoding="utf-8"))
    project = next(item["name"] for item in projects["repositories"] if item["name"] == "npm-safe")
    prefix, dash, suffix = project.partition("-")
    return {
        "nisconder-avatar": portrait,
        "nisconder-mark": mark,
        "ics-8086": word_label(course, machine, "#ebe6f0", "#533f62"),
        "npm-safe": word_label(prefix + dash, suffix, "#dcece4", "#214d40"),
    }


if __name__ == "__main__":
    labels = site_labels()
    for name, size in (("record-labels.webp", 88), ("record-labels-hd.webp", 176)):
        atlas = Image.new("RGB", (size, size * len(labels)))
        for index, tile in enumerate(labels.values()):
            atlas.paste(tile.resize((size, size), Image.Resampling.LANCZOS), (0, index * size))
        atlas.save(ROOT / "src/assets" / name, quality=87, method=6)
    (ROOT / "src/data/record-prints.json").write_text(json.dumps(list(labels)) + "\n", encoding="utf-8")
