#!/usr/bin/env python3
"""Build launcher, splash, notification, and in-app logos from the Tordroid mark.

The source is a square black field with a tall diamond. Launcher icons crop to
the controller and TORDROID.COM so the mark survives a home-screen mask.
Splash and the in-app logo keep the full diamond, including UNIVERSAL LABS.
"""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'assets' / 'brand' / 'tordroid-logo.jpg'
BLACK_CUTOFF = 26

# Inclusive boxes measured from the source artwork.
FULL_MARK = (673, 349, 1367, 1768)
# Start below the upper chevron so its tips are not clipped into the square icon.
LAUNCHER_LOCKUP = (680, 610, 1359, 1214)
CONTROLLER = (736, 610, 1311, 927)


def crop(image: Image.Image, box: tuple[int, int, int, int], pad: int = 12) -> Image.Image:
    left, top, right, bottom = box
    left = max(0, left - pad)
    top = max(0, top - pad)
    right = min(image.width - 1, right + pad)
    bottom = min(image.height - 1, bottom + pad)
    return image.crop((left, top, right + 1, bottom + 1))


def knockout_black(image: Image.Image) -> Image.Image:
    image = image.convert('RGBA')
    pixels = image.load()
    for y in range(image.height):
        for x in range(image.width):
            red, green, blue, _alpha = pixels[x, y]
            peak = max(red, green, blue)
            if peak <= BLACK_CUTOFF:
                pixels[x, y] = (0, 0, 0, 0)
    return image


def fit(mark: Image.Image, size: int, fraction: float, background: tuple[int, int, int, int]) -> Image.Image:
    canvas = Image.new('RGBA', (size, size), background)
    mark = mark.convert('RGBA')
    limit = max(1, int(size * fraction))
    scale = min(limit / mark.width, limit / mark.height)
    resized = mark.resize(
        (max(1, round(mark.width * scale)), max(1, round(mark.height * scale))),
        Image.Resampling.LANCZOS,
    )
    canvas.paste(
        resized,
        ((size - resized.width) // 2, (size - resized.height) // 2),
        resized,
    )
    return canvas


def to_white(image: Image.Image) -> Image.Image:
    image = image.convert('RGBA')
    white = Image.new('RGBA', image.size, (255, 255, 255, 0))
    white.putalpha(image.getchannel('A'))
    return white


def save(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, 'PNG', optimize=True)


def main() -> None:
    source = knockout_black(Image.open(SOURCE).convert('RGB'))
    full = crop(source, FULL_MARK, 8)
    lockup = crop(source, LAUNCHER_LOCKUP, 8)
    controller = crop(source, CONTROLLER, 6)
    black = (0, 0, 0, 255)
    clear = (0, 0, 0, 0)

    # Adaptive foreground keeps the artwork inside the 66dp safe zone of a 108dp icon.
    save(fit(lockup, 1024, 0.60, clear), ROOT / 'assets' / 'adaptive_icon.png')
    save(fit(to_white(lockup), 1024, 0.60, clear), ROOT / 'assets' / 'adaptive_icon_monochrome.png')
    # Legacy launcher can use more of the square because it is not masked as tightly.
    save(fit(lockup, 1024, 0.82, black), ROOT / 'assets' / 'icon.png')
    save(fit(full, 768, 0.92, black), ROOT / 'assets' / 'brand' / 'logo.png')

    splash_scales = {
        'logo.png': 200,
        'logo@1,5x.png': 300,
        'logo@2x.png': 400,
        'logo@3x.png': 600,
        'logo@4x.png': 800,
    }
    for name, size in splash_scales.items():
        save(fit(full, size, 0.92, black), ROOT / 'assets' / 'bootsplash' / name)

    densities = {
        'mdpi': 288,
        'hdpi': 432,
        'xhdpi': 576,
        'xxhdpi': 864,
        'xxxhdpi': 1152,
    }
    splash_names = [
        'bootsplash_logo.png',
        'bootsplash_logo_white.png',
        'bootsplash_logo_tomato.png',
        'bootsplash_logo_gray.png',
        'bootsplash_logo_blue.png',
        'bootsplash_logo_lavender.png',
    ]
    for density, size in densities.items():
        frame = fit(full, size, 0.88, black)
        folder = ROOT / 'assets' / 'bootsplash' / 'android' / f'drawable-{density}'
        for name in splash_names:
            save(frame, folder / name)

    banner = Image.new('RGBA', (320, 180), black)
    banner_mark = fit(lockup, 180, 0.86, clear)
    banner.paste(banner_mark, ((320 - 180) // 2, 0), banner_mark)
    save(banner, ROOT / 'assets' / 'tv-banner.png')
    for name in (
        'tv_banner_white.png',
        'tv_banner_tomato.png',
        'tv_banner_gray.png',
        'tv_banner_blue.png',
        'tv_banner_lavender.png',
    ):
        save(banner, ROOT / 'assets' / 'tv-banners' / name)

    notification_sizes = {
        'drawable-mdpi': 24,
        'drawable-hdpi': 36,
        'drawable': 36,
        'drawable-xhdpi': 48,
        'drawable-xxhdpi': 72,
        'drawable-xxxhdpi': 96,
    }
    for folder, size in notification_sizes.items():
        save(
            fit(to_white(controller), size, 0.92, clear),
            ROOT / 'assets' / 'android' / 'notification' / folder / 'ic_notification.png',
        )

    print('Wrote Droid Stream brand assets from', SOURCE)


if __name__ == '__main__':
    main()
