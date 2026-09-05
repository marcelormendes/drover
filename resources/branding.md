# Drover artwork

`icon-1024.png` is the canonical artwork: a navy and ivory herding dog on a blue
rounded tile, with transparency outside the tile. It replaces the former
Command-shaped mark.

Generated with the built-in image generation tool using this prompt:

> Use case: logo-brand. Create one original production-ready square app icon for
> Drover, a desktop application for coordinating coding agents. A distinctive,
> bold geometric herding-dog head in profile looking to the right, using a very
> small number of clean interlocking solid shapes. Intelligent, calm,
> forward-moving character; mature software brand, not a cute cartoon mascot.
> Dark near-black/navy silhouette with a restrained pale face cutout, on the
> application's existing cornflower-blue rounded-square tile. Strong recognizable
> silhouette, one pointed ear, compact muzzle, generous clear margins, crisp
> vector-like edges, legible at 24 pixels. Flat colors, no texture, no gradient,
> no 3D, no shadow, no typography, no letter, no keyboard command symbol, no
> four-loop/clover shape, no watermark, no mockup or presentation sheet. The
> single icon fills a 1024x1024 canvas; tile inset about 6% with smoothly rounded
> corners and genuinely transparent canvas outside the tile. Make this a cohesive
> finished app icon, centered and optically balanced.

Run `npm run icons:generate` on macOS after replacing the master. This creates
`resources/icon.icns` for the macOS bundle and `flatpak/icon-512.png` for Flatpak.
The app header, chat welcome screen, Dock, window icon, and AppImage consume the
master directly. `npm run site:build` copies it to `dist/site/icon.png` and adds an
artwork-derived cache key to the website header, favicon, and Apple touch icon.
The Linux installer also downloads that site's `icon.png`.

Commit the master and both generated package assets together. The old SVG artwork
was removed; there is no separate vector version to maintain.
