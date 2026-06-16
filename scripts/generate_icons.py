#!/usr/bin/env python3
"""Generate Pinmark's icon set with zero third-party dependencies.

Renders a 512px master PNG (a white bookmark glyph on a rounded blue square)
using a small built-in PNG encoder and supersampled antialiasing, then asks
`sips` to produce the smaller sizes. Re-run any time the mark changes.
"""

import math
import os
import struct
import subprocess
import zlib

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "src", "icons")
MASTER = 512
SSAA = 4  # subsamples per axis -> 16x coverage sampling
SIZES = [256, 128, 48, 32, 16]

# Accent blue matches the popup's --accent.
BG = (0x0A, 0x6C, 0xFF)
GLYPH = (0xFF, 0xFF, 0xFF)


def sd_round_box(px, py, half, radius):
    """Signed distance to a rounded square centred at (0.5, 0.5)."""
    dx = abs(px - 0.5) - (half - radius)
    dy = abs(py - 0.5) - (half - radius)
    ox, oy = max(dx, 0.0), max(dy, 0.0)
    return math.hypot(ox, oy) - radius + min(max(dx, dy), 0.0)


# Bookmark ribbon polygon (normalised coords): rectangle with a V notch cut into
# the bottom edge.
BOOKMARK = [
    (0.31, 0.23),
    (0.69, 0.23),
    (0.69, 0.79),
    (0.50, 0.62),
    (0.31, 0.79),
]


def in_polygon(x, y, poly):
    inside = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y):
            xc = (xj - xi) * (y - yi) / (yj - yi) + xi
            if x < xc:
                inside = not inside
        j = i
    return inside


def sample(u, v):
    """Return (r, g, b, a) in 0..255 for one point in the unit square."""
    if sd_round_box(u, v, 0.5, 0.115) > 0:
        return (0, 0, 0, 0)
    if in_polygon(u, v, BOOKMARK):
        return (*GLYPH, 255)
    return (*BG, 255)


def render(size):
    pixels = bytearray(size * size * 4)
    inv = 1.0 / (size * SSAA)
    for py in range(size):
        for px in range(size):
            ar = ag = ab = 0.0
            cov = 0
            for sy in range(SSAA):
                v = (py * SSAA + sy + 0.5) * inv
                for sx in range(SSAA):
                    u = (px * SSAA + sx + 0.5) * inv
                    r, g, b, a = sample(u, v)
                    if a:
                        ar += r
                        ag += g
                        ab += b
                        cov += 1
            n = SSAA * SSAA
            i = (py * size + px) * 4
            if cov:
                pixels[i] = round(ar / cov)
                pixels[i + 1] = round(ag / cov)
                pixels[i + 2] = round(ab / cov)
                pixels[i + 3] = round(cov / n * 255)
            # else leaves transparent zeros
    return pixels


def write_png(path, size, pixels):
    stride = size * 4
    raw = bytearray()
    for y in range(size):
        raw.append(0)  # no per-row filter
        raw.extend(pixels[y * stride : (y + 1) * stride])

    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # RGBA, 8-bit
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", ihdr))
        f.write(chunk(b"IDAT", zlib.compress(bytes(raw), 9)))
        f.write(chunk(b"IEND", b""))


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    master_path = os.path.join(OUT_DIR, f"icon-{MASTER}.png")
    print(f"Rendering {MASTER}px master (SSAA {SSAA})…")
    write_png(master_path, MASTER, render(MASTER))

    for size in SIZES:
        dst = os.path.join(OUT_DIR, f"icon-{size}.png")
        subprocess.run(
            ["sips", "-z", str(size), str(size), master_path, "--out", dst],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        print(f"  -> icon-{size}.png")
    print("Done.")


if __name__ == "__main__":
    main()
