# Drover artwork

`icon-1024.png` is the canonical artwork: a navy and ivory herding dog on a blue
rounded tile, with transparency outside the tile. It replaces the former
Command-shaped mark.

Generated with the built-in image generation tool. Design brief: "A bold geometric
herding-dog profile facing right, navy and ivory on a blue rounded tile, legible at
24 pixels; no Command symbol, clover, letters, or text."

Run `npm run icons:generate` on macOS after replacing the master. This creates
`resources/icon.icns` for the macOS bundle and `flatpak/icon-512.png` for Flatpak.
The app header, chat welcome screen, Dock, window icon, and AppImage consume the
master directly. `npm run site:build` copies it to `dist/site/icon.png` and adds an
artwork-derived cache key to the website header, favicon, and Apple touch icon.
The Linux installer also downloads that site's `icon.png`.

Commit the master and both generated package assets together. The old SVG artwork
was removed; there is no separate vector version to maintain.
