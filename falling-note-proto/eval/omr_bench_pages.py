"""Make sheet-music test pages with known notes.

Takes the first N bars of real piano scores (ASAP set, MusicXML), draws them as a page with Verovio, and saves them as images the way
people actually have them: a small web/screenshot size, a 300 dpi print size, and a camera-style photo (tilt, shadow, blur, grain, JPEG).
The trimmed MusicXML next to each image is the answer key.

Needs (in a throwaway environment): pip install verovio pymupdf pillow numpy
usage: python omr_bench_pages.py asap_dir out_dir [bars]
"""
import os
import re
import sys
import xml.etree.ElementTree as ET

import fitz
import numpy as np
import verovio
from PIL import Image, ImageFilter

PIECES = ["Bach__Prelude__bwv_848", "Beethoven__Piano_Sonatas__21-2", "Beethoven__Piano_Sonatas__7-3", "Chopin__Etudes_op_10__2",
          "Haydn__Keyboard_Sonatas__32-1", "Mozart__Piano_Sonatas__12-2", "Schubert__Moment_musical_no_3", "Schumann__Kreisleriana__4"]


def trim(src, bars):
    tree = ET.parse(src)
    for part in tree.getroot().iter("part"):
        ms = part.findall("measure")
        for m in ms[bars:]:
            part.remove(m)
    return tree


def render(xml_text, width_px):
    tk = verovio.toolkit()
    tk.setOptions({"pageWidth": 2100, "pageHeight": 8000, "scale": 100, "adjustPageHeight": True, "header": "none", "footer": "none", "breaks": "auto", "svgViewBox": True})
    tk.loadData(xml_text)
    svg = tk.renderToSVG(1)
    # MuPDF mishandles Verovio's nested <svg viewBox="0 0 21000 ..."> (it draws one giant glyph), so make that a plain scaled group
    m = re.search(r'<svg class="definition-scale"[^>]*viewBox="0 0 (\d+) (\d+)"[^>]*>', svg)
    k = 2100 / int(m.group(1))
    svg = svg[:m.start()] + '<g transform="scale(%s)" color="black" fill="black" stroke="black" stroke-width="0">' % k + svg[m.end():]
    i = svg.rindex("</svg>", 0, svg.rindex("</svg>"))
    svg = svg[:i] + "</g>" + svg[i + len("</svg>"):]
    doc = fitz.open(stream=svg.encode("utf-8"), filetype="svg")
    page = doc[0]
    zoom = width_px / page.rect.width
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), colorspace=fitz.csGRAY, alpha=False)
    return Image.frombytes("L", (pix.width, pix.height), pix.samples), tk.getPageCount()


def photo(im, tilt=2.0, blur=1.0, noise=10.0, shadow=0.35, quality=60, seed=1):
    rng = np.random.default_rng(seed)
    pad = Image.new("L", (im.width + 160, im.height + 160), 205)          # a grey desk around the page
    pad.paste(im, (80, 80))
    pad = pad.rotate(tilt, resample=Image.BICUBIC, fillcolor=205)
    a = np.asarray(pad, dtype=np.float32)
    h, w = a.shape
    light = 1 - shadow * (0.6 * np.linspace(0, 1, w)[None, :] + 0.4 * np.linspace(0, 1, h)[:, None])
    a = np.asarray(Image.fromarray(np.clip(a * light, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(blur)), dtype=np.float32)
    a += rng.normal(0, noise, a.shape)
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)), quality


if __name__ == "__main__":
    asap, out = sys.argv[1], sys.argv[2]
    bars = int(sys.argv[3]) if len(sys.argv) > 3 else 12
    os.makedirs(out, exist_ok=True)
    for name in PIECES:
        tree = trim(os.path.join(asap, name + ".musicxml"), bars)
        truth = os.path.join(out, name + ".truth.xml")
        tree.write(truth, encoding="utf-8", xml_declaration=True)
        text = open(truth, encoding="utf-8").read()
        pages = None
        for tag, w in (("screen", 850), ("print", 2480), ("photo", 1400)):
            im, pages = render(text, w)
            if tag == "photo":
                im, q = photo(im)
                im.save(os.path.join(out, name + ".photo.jpg"), quality=q)
            else:
                im.save(os.path.join(out, name + "." + tag + ".png"))
        print(name, "pages:", pages, "size(screen):", render(text, 850)[0].size)
