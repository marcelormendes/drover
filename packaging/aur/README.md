# AUR package — herdr-desktop-bin

Arch/omarchy package for Herdr Desktop. Based on the official GitHub Release
AppImage (the exact artifact CI builds and validates), installed to
`/usr/bin/herdr-desktop` with a system desktop entry and icon.

Named `herdr-desktop-bin` per AUR rules (prebuilt upstream artifact while
source is available), with `provides=('herdr-desktop')` and
`conflicts=('herdr-desktop')`.

## Files

- `PKGBUILD` — AppImage-based package. `pkgver` follows the release version;
  all three `sha256sums` are pinned from immutable sources: the AppImage from
  the release `checksums.sha256`, the icon and LICENSE from the matching Git
  tag's `resources/` and `LICENSE`. `options=('!strip' '!debug')` is
  mandatory — the AppImage is a self-contained ELF whose embedded filesystem
  is destroyed by default stripping.
- `.SRCINFO` — generated with `makepkg --printsrcinfo`; must be regenerated
  whenever the PKGBUILD changes.

## Local build test

```sh
cd packaging/aur
makepkg -f             # build without installing (no root)
makepkg -si            # build and install (root)
herdr-desktop          # launch (fuse2 provides FUSE mounting)
```

## Release flow (per version)

1. Update `pkgver` and the three `sha256sums` (AppImage from the release's
   `checksums.sha256`; icon + LICENSE from the tagged raw files); bump
   `pkgrel` if the packaging changed without a new upstream version.
2. `makepkg --printsrcinfo > .SRCINFO`
3. Commit and push to the AUR repository `aur.archlinux.org/herdr-desktop-bin.git`
   (maintainer step; requires AUR SSH access).

## Notes

- `fuse2` is a hard dependency: the AppImage requires FUSE to mount; without
  it the runtime does not fall back to extraction automatically.
- `herdr` (the engine) is not a pacman package; it is listed as an optdepend
  with a pointer to the Herdr project install.
