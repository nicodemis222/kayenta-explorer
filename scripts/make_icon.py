"""Render the Kayenta Explorer app icon at 1024×1024 PNG.

Theme: Kayenta is a real-estate explorer for Southern Utah's red-rock country,
hunting farmland, cabins, and bunker-conversion candidates. The icon evokes
that landscape:

  - dusty desert-sky gradient up top
  - stacked mesa silhouettes in warm sandstone / rust / deep canyon red
  - a cream map-pin / location marker as the centerpiece (this is a
    property-finder app, after all)
  - a faint underground bunker arch below the surface line, a small nod to
    the commercial/bunker mode without making the icon read as military

Designed to be legible at 32 px while staying interesting at 1024.
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

SIZE = 1024
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("icon.png")

# Red-rock palette (Kayenta sandstone, sunset-tinted)
SKY_TOP    = (88, 122, 148)   # dusty teal-blue
SKY_BOTTOM = (228, 168, 124)  # warm haze
MESA_RIM   = (216, 138, 90)   # bright sandstone
MESA_BODY  = (190, 95, 62)    # rust red
CANYON     = (132, 52, 44)    # deep burgundy
SHADOW     = (74, 32, 28)     # canyon-floor shadow
UNDERGROUND = (52, 36, 30)    # earth below the surface line
PIN_GOLD   = (244, 208, 122)  # warm cream gold
PIN_GOLD_RIM = (224, 178, 92) # darker rim
PIN_DARK   = (50, 38, 28)     # pin centerpoint + outline
BUNKER     = (224, 188, 130, 220)  # cream — visible but not loud


def vertical_gradient(w: int, h: int, stops: list[tuple[float, tuple[int, int, int]]]) -> Image.Image:
    """Linear vertical gradient across (0..1) y-stops."""
    img = Image.new("RGB", (w, h))
    px = img.load()
    stops = sorted(stops, key=lambda s: s[0])
    for y in range(h):
        t = y / (h - 1)
        for i in range(len(stops) - 1):
            t0, c0 = stops[i]
            t1, c1 = stops[i + 1]
            if t0 <= t <= t1:
                k = (t - t0) / (t1 - t0) if t1 > t0 else 0
                r = int(c0[0] + (c1[0] - c0[0]) * k)
                g = int(c0[1] + (c1[1] - c0[1]) * k)
                b = int(c0[2] + (c1[2] - c0[2]) * k)
                break
        else:
            r, g, b = stops[-1][1]
        for x in range(w):
            px[x, y] = (r, g, b)
    return img


def rounded_mask(w: int, h: int, radius: int) -> Image.Image:
    m = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle((0, 0, w - 1, h - 1), radius=radius, fill=255)
    return m


def draw_mesas(canvas: Image.Image) -> None:
    """Three stacked mesa profiles — back/mid/front — in receding warm reds.

    Mesa silhouettes are flat-topped with vertical canyon-cut sides, the
    signature Southern Utah / Kayenta-region profile. Each layer steps a
    little darker / further forward.
    """
    w, h = canvas.size
    overlay = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)

    # Surface line — where above-ground meets earth. About 78% of the way down.
    SURFACE_Y = h * 0.78

    # Back mesa — distant ridge, lighter, behind everything else.
    back = [
        (-20,           h * 0.60),
        (w * 0.10,      h * 0.55),
        (w * 0.10,      h * 0.42),
        (w * 0.30,      h * 0.42),
        (w * 0.30,      h * 0.50),
        (w * 0.55,      h * 0.50),
        (w * 0.55,      h * 0.38),
        (w * 0.78,      h * 0.38),
        (w * 0.78,      h * 0.52),
        (w + 20,        h * 0.52),
        (w + 20,        SURFACE_Y),
        (-20,           SURFACE_Y),
    ]
    d.polygon(back, fill=MESA_RIM)

    # Middle band — the body of the mesa, deeper red.
    mid = [
        (-20,           h * 0.74),
        (w * 0.06,      h * 0.64),
        (w * 0.06,      h * 0.56),
        (w * 0.22,      h * 0.56),
        (w * 0.22,      h * 0.66),
        (w * 0.42,      h * 0.66),
        (w * 0.42,      h * 0.52),
        (w * 0.72,      h * 0.52),
        (w * 0.72,      h * 0.62),
        (w * 0.92,      h * 0.62),
        (w * 0.92,      h * 0.72),
        (w + 20,        h * 0.72),
        (w + 20,        SURFACE_Y),
        (-20,           SURFACE_Y),
    ]
    d.polygon(mid, fill=MESA_BODY)

    # Foreground butte — closer, darker, with a single tall block centered.
    front = [
        (-20,           SURFACE_Y),
        (w * 0.02,      h * 0.74),
        (w * 0.02,      h * 0.66),
        (w * 0.18,      h * 0.66),
        (w * 0.18,      h * 0.72),
        (w * 0.36,      h * 0.72),
        (w * 0.36,      h * 0.62),
        (w * 0.64,      h * 0.62),
        (w * 0.64,      h * 0.72),
        (w * 0.82,      h * 0.72),
        (w * 0.82,      h * 0.66),
        (w * 0.98,      h * 0.66),
        (w + 20,        h * 0.74),
        (w + 20,        SURFACE_Y),
    ]
    d.polygon(front, fill=CANYON)

    # Below the surface — solid earth tone.
    earth = [(-20, SURFACE_Y), (w + 20, SURFACE_Y), (w + 20, h + 20), (-20, h + 20)]
    d.polygon(earth, fill=UNDERGROUND)

    canvas.alpha_composite(overlay)


def draw_bunker(canvas: Image.Image) -> None:
    """Faint half-circle dome below the surface — the bunker hint.

    Sits beneath the centre mesa block. Cream colour so it reads as "there is
    something here" without dominating the icon. The dome's curved roof tucks
    just under the surface line and its flat floor rests on the underground
    earth, so the shape reads as buried-but-visible.
    """
    w, h = canvas.size
    overlay = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)

    SURFACE_Y = h * 0.78
    cx = w * 0.5
    half_width = w * 0.16
    height     = h * 0.10
    # Floor of the dome sits well below the surface line.
    floor_y = SURFACE_Y + height + 4

    # Build the upper-half-of-ellipse polygon. Parametric sweep from the
    # right end of the floor around the top arc back to the left end, then
    # close along the floor.
    pts = []
    n = 60
    for i in range(n + 1):
        theta = math.pi * (i / n)  # 0 → π, sweeping left along the top
        x = cx + half_width * math.cos(theta)
        y = floor_y - height * math.sin(theta)
        pts.append((x, y))
    d.polygon(pts, fill=BUNKER)

    # Floor line under the dome — slightly darker to define the base.
    d.line(
        (cx - half_width + 8, floor_y, cx + half_width - 8, floor_y),
        fill=(120, 80, 50, 240), width=4,
    )

    # Two interior support pillars — short vertical lines inside the dome
    # so the shape reads as a structure rather than just a hump.
    for off in (-half_width * 0.40, half_width * 0.40):
        d.line(
            (cx + off, floor_y - 6, cx + off, floor_y - height * 0.55),
            fill=(120, 80, 50, 200), width=3,
        )

    # Small entrance shaft from just below the surface line down to the dome
    shaft_w = w * 0.022
    shaft_top = SURFACE_Y + 2
    shaft_bottom = floor_y - height + 4
    if shaft_bottom > shaft_top:
        d.rectangle(
            (cx - shaft_w / 2, shaft_top, cx + shaft_w / 2, shaft_bottom),
            fill=BUNKER,
        )

    canvas.alpha_composite(overlay)


def draw_pin(canvas: Image.Image) -> None:
    """Centerpiece map pin — classic teardrop with a hollow circle inside.

    Sits in the upper third so it doesn't compete with the mesa horizon. Gold
    fill with a dark outline so it pops against either sky or mesa.
    """
    w, h = canvas.size
    overlay = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)

    cx = w * 0.5
    head_cy = h * 0.32
    head_r = w * 0.18
    tip_y  = h * 0.66  # the pointy bottom of the teardrop

    # Cast shadow under the pin (subtle, helps the pin float above the mesa).
    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.ellipse(
        (cx - head_r * 0.7, tip_y - 18, cx + head_r * 0.7, tip_y + 16),
        fill=(0, 0, 0, 110),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=12))
    canvas.alpha_composite(shadow)

    # Teardrop body: circular head + triangular tail meeting at a single tip.
    # Compute the two tangent points on the circle where the tail's straight
    # sides meet the head, so the shape looks geometrically clean.
    dx = 0
    dy = tip_y - head_cy
    dist = math.hypot(dx, dy)
    # tangent angle from the centre of the circle to the tip
    alpha = math.asin(head_r / dist)
    # Direction from head centre to tip (straight down in our layout).
    base_ang = math.atan2(dy, dx)
    left_ang  = base_ang + (math.pi / 2 - alpha)
    right_ang = base_ang - (math.pi / 2 - alpha)
    left_tangent  = (cx + math.cos(left_ang)  * head_r, head_cy + math.sin(left_ang)  * head_r)
    right_tangent = (cx + math.cos(right_ang) * head_r, head_cy + math.sin(right_ang) * head_r)

    # Outer dark outline first (slightly larger), then the gold fill on top.
    OUTLINE = 14
    d.ellipse(
        (cx - head_r - OUTLINE, head_cy - head_r - OUTLINE,
         cx + head_r + OUTLINE, head_cy + head_r + OUTLINE),
        fill=PIN_DARK,
    )
    d.polygon(
        [
            (left_tangent[0] - OUTLINE * 0.7,  left_tangent[1]  + OUTLINE * 0.2),
            (right_tangent[0] + OUTLINE * 0.7, right_tangent[1] + OUTLINE * 0.2),
            (cx, tip_y + OUTLINE * 0.5),
        ],
        fill=PIN_DARK,
    )

    d.ellipse(
        (cx - head_r, head_cy - head_r, cx + head_r, head_cy + head_r),
        fill=PIN_GOLD,
        outline=PIN_GOLD_RIM,
        width=4,
    )
    d.polygon([left_tangent, right_tangent, (cx, tip_y)], fill=PIN_GOLD)

    # Inner ring on the pin head (the classic "hole")
    inner_r = head_r * 0.42
    d.ellipse(
        (cx - inner_r, head_cy - inner_r, cx + inner_r, head_cy + inner_r),
        fill=PIN_DARK,
    )
    inner_r2 = inner_r * 0.55
    d.ellipse(
        (cx - inner_r2, head_cy - inner_r2, cx + inner_r2, head_cy + inner_r2),
        fill=PIN_GOLD,
    )

    canvas.alpha_composite(overlay)


def main() -> None:
    bg = vertical_gradient(
        SIZE, SIZE,
        [
            (0.00, SKY_TOP),
            (0.55, SKY_BOTTOM),
            (0.78, MESA_RIM),
            (1.00, UNDERGROUND),
        ],
    ).convert("RGBA")

    draw_mesas(bg)
    draw_bunker(bg)
    draw_pin(bg)

    # Rounded-square mask — macOS Big Sur+ icon shape (~22.5% corner radius).
    mask = rounded_mask(SIZE, SIZE, radius=int(SIZE * 0.225))
    out = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    out.paste(bg, (0, 0), mask=mask)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    out.save(OUT, format="PNG")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
