# Flathub submission — io.github.marcelormendes.drover

## Submission status: BLOCKED — requires an explicit Flathub exception

Do **not** submit this package yet. Under Flathub's current
[requirements](https://docs.flathub.org/docs/for-app-authors/requirements)
and [linter exception policy](https://docs.flathub.org/docs/for-app-authors/linter),
this app is policy-ineligible until **all of the following gates are
resolved**:

1. **Host dependence** — Drover's core functionality runs the host
   `herdr` CLI, connects to Herdr's Unix sockets, controls host terminals,
   and uses host SSH tools.
2. **Sandbox escape** — the manifest grants `--talk-name=org.freedesktop.Flatpak`
   and the app routes host commands through `flatpak-spawn --host`. Flathub
   explicitly states such exceptions will not be granted when AI-assisted
   application/submission material is evident, and this project's submission
   material (README/metainfo wording) is AI-drafted — reviewing it "by hand"
   does not remove that provenance.
3. **Prebuilt-archive build** — this manifest repackages the official Forge
   Linux zip. Source-available submissions must build from source unless this
   is separately excepted (or a source build module must be implemented).
4. **Display fallback** — the manifest opens both X11 and Wayland sockets.
   The normal resolution is to replace the unrestricted `--socket=x11` with
   `--socket=fallback-x11` (X11 only as a Wayland fallback); an exception is
   required only if both unrestricted X11 and Wayland are genuinely
   necessary.
5. **Pending real SHA** — the archive `sha256` in the manifest is currently a
   `CHANGE-ME` placeholder: it can only be pinned once the first release
   containing `drover-linux-x64.zip` (v0.1.11+) publishes and its
   `checksums.sha256` is available.

Before any submission: resolve items 1–4 as described above, obtaining
explicit Flathub exceptions only where required (host dependence,
flatpak-spawn and material provenance, prebuilt-archive or source build, and
display only if unrestricted X11 remains necessary), human-rewrite the
AppStream description and submission wording, and fill the real SHA (5). The
files in this directory are the technical groundwork and are kept current for
the day that exception lands.

## Files

- `io.github.marcelormendes.drover.yml` — the manifest. It will pin the
  archive `url`+`sha256` (currently a `CHANGE-ME` placeholder pending the
  first release that ships the linux zip) and the git `tag` to one release.
- `flathub.json` — x86_64-only (matches the published artifacts).

## Technical build (still useful locally)

The manifest builds from the official Forge Linux package (zip) plus the
matching release tag for the `flatpak/` assets, with no local build inputs.
Per-release regeneration for `v0.1.11+` (the first release with the linux
zip):

1. Confirm the release includes `drover-linux-x64.zip`.
2. In the manifest: set `url` to
   `…/releases/download/v<version>/drover-linux-x64.zip`, copy the zip
   hash from the release `checksums.sha256` into `sha256`, set the git `tag`
   to `v<version>`, and update the `sed` `__VERSION__`/`__DATE__` literals.
3. Local test (requires flatpak tooling):
   ```sh
   flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
   flatpak-builder --user --install-deps-from=flathub build packaging/flathub/io.github.marcelormendes.drover.yml
   flatpak-builder --user --install --force-clean build packaging/flathub/io.github.marcelormendes.drover.yml
   flatpak run io.github.marcelormendes.drover
   appstreamcli validate --no-net build/files/share/metainfo/io.github.marcelormendes.drover.metainfo.xml
   ```
4. Submit: request the Flathub repository
   (`io.github.marcelormendes.drover`) via the Flathub "New apps"
   process, then open a PR against `flathub/flathub` with
   `io.github.marcelormendes.drover/` containing the manifest,
   `flathub.json`, and the same release-tagged `flatpak/` assets
   (wrapper/desktop/metainfo/icons are pulled from the git source in this
   manifest, so only these two files plus a README belong in the submission).

## Notes

- The GitHub Release bundle (`flatpak/` in this repo) remains the
  zero-review, per-user install path; Flathub is the discoverable store path
  for Ubuntu and other distributions.
- Only x86_64 is published, so `flathub.json` restricts arches accordingly.
