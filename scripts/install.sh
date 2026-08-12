#!/bin/sh
#
# Drover Linux installer.
#
# Installs the Drover AppImage per-user (no root required): binary into
# ~/.local/bin, app icon, and a desktop entry so the app appears in the
# application menu. The AppImage download is verified against the SHA-256
# checksum published with the release before anything is installed.
#
# Usage:
#   curl -fsSL https://marcelormendes.github.io/drover/install.sh | sh
#
# Flags:
#   --version <tag>   Install a specific release tag (e.g. --version v0.1.8).
#                     Defaults to the latest release.
#   --uninstall       Remove the files this installer writes. Never touches
#                     anything else.
#   --base-url <url>  Advanced: download the AppImage and checksums from
#                     <url> instead of the GitHub release. Primarily for
#                     testing against a local mirror.
#   --icon-url <url>  Advanced: fetch the app icon from <url>. Defaults to the
#                     Drover website.
#   --help            Show this message.

set -eu

: "${HOME:?HOME is not set; cannot determine the install location}"

REPO="marcelormendes/drover"
ASSET_NAME=""
DEFAULT_BASE_URL="https://github.com/${REPO}/releases/latest/download"
DEFAULT_ICON_URL="https://marcelormendes.github.io/drover/icon.png"
VERSION=""
BASE_URL="${DEFAULT_BASE_URL}"
ICON_URL="${DEFAULT_ICON_URL}"
UNINSTALL=0

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<EOF
Drover Linux installer

Usage: $0 [--version <tag>] [--uninstall] [--help]
       curl -fsSL https://marcelormendes.github.io/drover/install.sh | sh
EOF
}

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --help)
        usage
        exit 0
        ;;
      --uninstall)
        UNINSTALL=1
        ;;
      --version=*)
        VERSION="${1#--version=}"
        ;;
      --version)
        shift
        [ "$#" -gt 0 ] || die "--version requires a value (e.g. --version v0.1.8)"
        VERSION="$1"
        ;;
      --base-url=*)
        BASE_URL="${1#--base-url=}"
        ;;
      --base-url)
        shift
        [ "$#" -gt 0 ] || die "--base-url requires a value"
        BASE_URL="$1"
        ;;
      --icon-url=*)
        ICON_URL="${1#--icon-url=}"
        ;;
      --icon-url)
        shift
        [ "$#" -gt 0 ] || die "--icon-url requires a value"
        ICON_URL="$1"
        ;;
      *)
        die "unknown argument: ${1} (see --help)"
        ;;
    esac
    shift
  done
}

resolve_asset_name() {
  case "$(uname -s)" in
    Linux) ;;
    *) die "this installer supports Linux only (found $(uname -s))" ;;
  esac
  case "$(uname -m)" in
    x86_64) ASSET_NAME="drover-linux-x86_64.AppImage" ;;
    aarch64) die "Linux arm64 builds are not published yet" ;;
    *) die "unsupported architecture: $(uname -m)" ;;
  esac
}

check_prerequisites() {
  command -v curl >/dev/null 2>&1 || die "curl is required but was not found"
  command -v sha256sum >/dev/null 2>&1 || die "sha256sum is required but was not found"
}

resolve_base_url() {
  if [ -n "${VERSION}" ]; then
    VERSION="${VERSION#/}"
    VERSION="${VERSION%/}"
    [ -n "${VERSION}" ] || die "--version requires a non-empty tag"
    BASE_URL="https://github.com/${REPO}/releases/download/${VERSION}"
  fi
}

uninstall() {
  bin_dir="$HOME/.local/bin"
  icon_file="$HOME/.local/share/icons/hicolor/1024x1024/apps/drover.png"
  desktop_file="$HOME/.local/share/applications/drover.desktop"
  removed=0
  for file in "${bin_dir}/drover" "${icon_file}" "${desktop_file}"; do
    if [ -e "$file" ] || [ -L "$file" ]; then
      rm -f -- "$file"
      printf 'removed %s\n' "$file"
      removed=1
    fi
  done
  if [ "$removed" -eq 0 ]; then
    echo "Drover is not installed; nothing to remove."
  fi
}

install_appimage() {
  tmpdir="$(mktemp -d)"
  staging=""
  trap 'rm -rf -- "$tmpdir"; [ -n "$staging" ] && rm -f -- "$staging"' EXIT INT TERM

  asset_url="${BASE_URL}/${ASSET_NAME}"
  checksum_url="${BASE_URL}/checksums.sha256"

  printf 'Downloading %s ...\n' "${ASSET_NAME}"
  curl -fSL --retry 3 -o "$tmpdir/${ASSET_NAME}" "$asset_url" \
    || die "failed to download ${asset_url}"
  curl -fSL --retry 3 -o "$tmpdir/checksums.sha256" "$checksum_url" \
    || die "failed to download ${checksum_url} (no unverified installs)"

  cd "$tmpdir"
  grep -F -- "$ASSET_NAME" checksums.sha256 >/dev/null \
    || die "no checksum entry for ${ASSET_NAME} in the published checksums"
  if ! grep -F -- "$ASSET_NAME" checksums.sha256 | sha256sum -c - >/dev/null 2>&1; then
    die "checksum verification failed for ${ASSET_NAME}; aborting (corrupted download or tampered release)"
  fi

  bin_dir="$HOME/.local/bin"
  mkdir -p "$bin_dir"
  # Stage inside the target directory so the final move is a same-filesystem
  # atomic rename, and set the mode before replacing the live binary.
  staging="$bin_dir/.drover.$$"
  mv -f "$tmpdir/${ASSET_NAME}" "$staging"
  chmod 0755 "$staging"
  mv -f "$staging" "$bin_dir/drover"
  staging=""

  if curl -fSL --retry 2 --max-time 60 -o "$tmpdir/icon.png" "$ICON_URL" 2>/dev/null; then
    icon_dir="$HOME/.local/share/icons/hicolor/1024x1024/apps"
    mkdir -p "$icon_dir"
    mv -f "$tmpdir/icon.png" "$icon_dir/drover.png"
  else
    printf 'note: could not download the app icon (optional; install continues)\n' >&2
  fi

  desktop_dir="$HOME/.local/share/applications"
  mkdir -p "$desktop_dir"
  cat > "$desktop_dir/drover.desktop" <<EOF
[Desktop Entry]
Type=Application
Version=1.5
Name=Drover
Comment=A native workspace for Herdr-powered agents, terminals, worktrees, and live sessions.
Exec=${bin_dir}/drover
Icon=drover
Terminal=false
Categories=Development;Utility;
EOF

  if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$desktop_dir" >/dev/null 2>&1 || true
  fi

  if [ -n "${VERSION}" ]; then
    version="$VERSION"
  else
    version="the latest release"
  fi
  printf '\nInstalled Drover %s\n' "$version"
  printf '  binary:  %s\n' "$bin_dir/drover"
  printf '  menu:    %s\n' "$desktop_dir/drover.desktop"
}

warn_missing_herdr() {
  if ! command -v herdr >/dev/null 2>&1; then
    printf 'note: the herdr CLI was not found on PATH. Drover needs it.\n' >&2
    printf '      Install it first: https://github.com/herdrdev/herdr\n' >&2
  fi
}

warn_bin_dir_not_on_path() {
  case ":${PATH}:" in
    *:"$HOME/.local/bin":*)
      BIN_ON_PATH=1
      ;;
    *)
      BIN_ON_PATH=0
      printf 'note: %s is not on your PATH.\n' "$HOME/.local/bin" >&2
      printf '      Add it to PATH, or run the app with:\n' >&2
      printf '      %s\n' "$HOME/.local/bin/drover" >&2
      ;;
  esac
}

main() {
  parse_args "$@"
  if [ "$UNINSTALL" -eq 1 ]; then
    uninstall
    exit 0
  fi
  check_prerequisites
  resolve_asset_name
  resolve_base_url
  install_appimage
  warn_missing_herdr
  warn_bin_dir_not_on_path
  if [ "$BIN_ON_PATH" -eq 1 ]; then
    printf 'Run it with: drover\n'
  else
    printf 'Run it with: %s\n' "$HOME/.local/bin/drover"
  fi
}

main "$@"
