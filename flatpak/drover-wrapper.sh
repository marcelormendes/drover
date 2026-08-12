#!/bin/sh
# Zypak-wrapped launcher for the Drover Flatpak.
#
# The org.electronjs.Electron2.BaseApp provides zypak-wrapper, which launches
# Electron/Chromium with the sandbox constraints the Flatpak grants while
# keeping the renderer sandbox and fuses enabled.
exec zypak-wrapper /app/drover/drover "$@"
