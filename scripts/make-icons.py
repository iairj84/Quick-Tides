#!/usr/bin/env python3
"""Rasterize public/logo.svg into the PNG icons an installable web app needs.

The logo is pure geometry (rounded square, one circle, two wave curves), so it
is redrawn here rather than pulled through an SVG rasterizer — no extra
dependency, and the output matches the source exactly.

Android/Chrome want 192 and 512 px `any` icons plus a 512 px `maskable` one
whose artwork survives the circular crop. Run from the repo root:

    python3 scripts/make-icons.py
"""

from pathlib import Path
from PIL import Image, ImageDraw

# Geometry from public/logo.svg (a 64x64 viewBox).
VIEWBOX = 64
INK = "#222f3b"
FOAM = "#eef6f9"
# Supersample, then downscale, so curves and strokes come out smooth.
SS = 4


def quad(p0, p1, p2, steps=64):
    """Points along a quadratic Bézier, end point excluded."""
    pts = []
    for i in range(steps):
        t = i / steps
        u = 1 - t
        pts.append(
            (
                u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
                u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
            )
        )
    return pts


def wave(y_top, rise):
    """`M8 y Q16 y-rise 24 y T40 y T56 y` — the logo's wave, as a polyline."""
    p0, p1, p2 = (8, y_top), (16, y_top - rise), (24, y_top)
    pts = [p0] + quad(p0, p1, p2)
    # T repeats the reflected control point, so each segment mirrors the last.
    for _ in (32, 48):
        start = pts[-1]
        ctrl = (start[0] + 8, y_top - rise)
        end = (start[0] + 16, y_top)
        pts += quad(start, ctrl, end)
    pts.append((56, y_top))
    return pts


def _rgb(hex_color):
    return tuple(int(hex_color[i:i + 2], 16) for i in (1, 3, 5))


def draw_logo(canvas, inset=0.0, radius=8.0):
    """Draw the mark into a square canvas. `inset` is a fraction of the side."""
    # The canvas is already supersampled, so work in its own pixels.
    size = canvas.size[0]
    pad = inset * size
    side = size - 2 * pad
    scale = side / VIEWBOX
    r = radius * scale

    dark = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    dd = ImageDraw.Draw(dark)
    dd.rounded_rectangle([pad, pad, pad + side, pad + side], radius=r, fill=INK)

    foam = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    fd = ImageDraw.Draw(foam)

    def at(x, y):
        return (pad + x * scale, pad + y * scale)

    # Moon: circle r=6 at (32, 21), 3 units of stroke.
    cx, cy = 32, 21
    fd.ellipse(
        [*at(cx - 6, cy - 6), *at(cx + 6, cy + 6)],
        outline=FOAM,
        width=max(1, round(3 * scale)),
    )

    # Two wave strokes. PIL's polyline joints leave nicks on curves this
    # shallow, so each stroke is stamped from overlapping discs: smooth joins
    # and round caps, exactly like the SVG's stroke-linecap="round".
    def stroke(points, width_units, rgba):
        radius = width_units * scale / 2
        for ux, uy in points:
            x, y = at(ux, uy)
            fd.ellipse([x - radius, y - radius, x + radius, y + radius], fill=rgba)

    stroke(wave(42, 10), 3, (*_rgb(FOAM), 255))
    stroke(wave(51, 7), 2, (*_rgb(FOAM), 115))

    canvas.alpha_composite(dark)
    canvas.alpha_composite(foam)


def render(path, size, inset=0.0, radius=8.0, background=None):
    canvas = Image.new("RGBA", (size * SS, size * SS), background or (0, 0, 0, 0))
    draw_logo(canvas, inset=inset, radius=radius)
    out = canvas.resize((size, size), Image.LANCZOS)
    out.save(path, "PNG", optimize=True)
    print(f"{path}  {size}x{size}  {Path(path).stat().st_size / 1024:.1f} KB")


def main():
    public = Path("public")
    if not (public / "logo.svg").exists():
        raise SystemExit("run this from the repo root")

    render(public / "icon-192.png", 192)
    render(public / "icon-512.png", 512)
    # Maskable: full-bleed dark square, artwork inside the 80% safe circle.
    render(public / "icon-maskable-512.png", 512, inset=0.18, radius=0,
           background=INK)
    render(public / "apple-touch-icon.png", 180, radius=0, background=INK)


if __name__ == "__main__":
    main()
