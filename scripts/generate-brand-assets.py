#!/usr/bin/env python3
"""Build Droid Stream art from the approved logo placement.

Logo 1 (gold D) is the app icon. Logo 2 (droid head) is the player button.
Logo 3 (hexagon) is the add-plugin button. The Tordroid website mark is
circle-cropped to the controller and TORDROID.COM for the Settings button.
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
BRAND = ROOT / 'assets' / 'brand'
APP_SOURCE = BRAND / 'logo1-app-icon.jpg'
PLAY_SOURCE = BRAND / 'logo2-play-button.jpg'
PLUGIN_SOURCE = BRAND / 'logo3-plugin-button.jpg'
WEBSITE_SOURCE = BRAND / 'tordroid-logo.jpg'
# Controller plus TORDROID.COM on the 2048px website mark. Chevrons and the
# Universal Labs tagline stay out of the circle.
WEBSITE_LOCKUP = (684, 630, 1359, 1205)
BLACK = (0, 0, 0, 255)
CLEAR = (0, 0, 0, 0)


def knockout(image: Image.Image, cutoff: int = 24, feather: int = 48) -> Image.Image:
    image = image.convert('RGBA')
    pixels = image.load()
    span = max(1, feather - cutoff)
    for y in range(image.height):
        for x in range(image.width):
            red, green, blue, _alpha = pixels[x, y]
            peak = max(red, green, blue)
            if peak <= cutoff:
                pixels[x, y] = (0, 0, 0, 0)
            elif peak < feather:
                pixels[x, y] = (red, green, blue, int(255 * (peak - cutoff) / span))
    return image


def trim(image: Image.Image) -> Image.Image:
    image = image.convert('RGBA')
    box = image.getchannel('A').getbbox()
    return image.crop(box) if box else image


def fit(mark: Image.Image, size: int, fraction: float, background: tuple[int, int, int, int]) -> Image.Image:
    canvas = Image.new('RGBA', (size, size), background)
    mark = mark.convert('RGBA')
    limit = max(1, int(round(size * fraction)))
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


def circle_crop(image: Image.Image) -> Image.Image:
    image = image.convert('RGBA')
    size = max(image.width, image.height)
    square = Image.new('RGBA', (size, size), CLEAR)
    square.paste(image, ((size - image.width) // 2, (size - image.height) // 2), image)
    mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(mask).ellipse((1, 1, size - 2, size - 2), fill=255)
    result = Image.new('RGBA', (size, size), CLEAR)
    result.paste(square, (0, 0), mask)
    return result


def save(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, 'PNG', optimize=True)


def main() -> None:
    app_mark = trim(knockout(Image.open(APP_SOURCE)))
    play_mark = trim(knockout(Image.open(PLAY_SOURCE)))
    plugin_mark = trim(knockout(Image.open(PLUGIN_SOURCE)))
    website = Image.open(WEBSITE_SOURCE).convert('RGB')
    lockup = website.crop(WEBSITE_LOCKUP)
    # Scale the lockup inside the circle so TORDROID.COM is not clipped.
    website_mark = circle_crop(fit(lockup.convert('RGBA'), 512, 0.78, (0, 0, 0, 255)))

    # 0.54 keeps the D and cast waves inside the 66dp adaptive safe circle.
    save(fit(app_mark, 1024, 0.54, CLEAR), ROOT / 'assets' / 'adaptive_icon.png')
    save(fit(to_white(app_mark), 1024, 0.54, CLEAR), ROOT / 'assets' / 'adaptive_icon_monochrome.png')
    save(fit(app_mark, 1024, 0.54, BLACK), ROOT / 'assets' / 'icon.png')
    save(fit(app_mark, 768, 0.88, CLEAR), BRAND / 'logo.png')
    save(fit(play_mark, 256, 0.94, CLEAR), BRAND / 'play-button.png')
    save(fit(plugin_mark, 256, 0.94, CLEAR), BRAND / 'plugin-button.png')
    save(website_mark.resize((256, 256), Image.Resampling.LANCZOS), BRAND / 'website-button.png')
    save(fit(app_mark, 512, 0.72, BLACK), ROOT / 'fastlane' / 'metadata' / 'android' / 'en-US' / 'images' / 'logo.png')

    for name, size in {
        'logo.png': 200,
        'logo@1,5x.png': 300,
        'logo@2x.png': 400,
        'logo@3x.png': 600,
        'logo@4x.png': 800,
    }.items():
        save(fit(app_mark, size, 0.84, BLACK), ROOT / 'assets' / 'bootsplash' / name)

    splash_names = [
        'bootsplash_logo.png',
        'bootsplash_logo_white.png',
        'bootsplash_logo_tomato.png',
        'bootsplash_logo_gray.png',
        'bootsplash_logo_blue.png',
        'bootsplash_logo_lavender.png',
    ]
    for density, size in {
        'mdpi': 288,
        'hdpi': 432,
        'xhdpi': 576,
        'xxhdpi': 864,
        'xxxhdpi': 1152,
    }.items():
        frame = fit(app_mark, size, 0.72, BLACK)
        folder = ROOT / 'assets' / 'bootsplash' / 'android' / f'drawable-{density}'
        for name in splash_names:
            save(frame, folder / name)

    banner = Image.new('RGBA', (320, 180), BLACK)
    banner_mark = fit(app_mark, 160, 0.92, CLEAR)
    banner.paste(banner_mark, ((320 - 160) // 2, (180 - 160) // 2), banner_mark)
    save(banner, ROOT / 'assets' / 'tv-banner.png')
    for name in (
        'tv_banner_white.png',
        'tv_banner_tomato.png',
        'tv_banner_gray.png',
        'tv_banner_blue.png',
        'tv_banner_lavender.png',
    ):
        save(banner, ROOT / 'assets' / 'tv-banners' / name)

    for folder, size in {
        'drawable-mdpi': 24,
        'drawable-hdpi': 36,
        'drawable': 36,
        'drawable-xhdpi': 48,
        'drawable-xxhdpi': 72,
        'drawable-xxxhdpi': 96,
    }.items():
        save(
            fit(to_white(app_mark), size, 0.9, CLEAR),
            ROOT / 'assets' / 'android' / 'notification' / folder / 'ic_notification.png',
        )

    print('app', app_mark.size, 'play', play_mark.size, 'plugin', plugin_mark.size)


if __name__ == '__main__':
    main()
