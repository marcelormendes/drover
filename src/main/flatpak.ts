import os from 'node:os';
import path from 'node:path';

/**
 * Flatpak host-command boundary.
 *
 * Herdr Desktop is host-dependent by design: it runs the host `herdr` CLI,
 * connects to Herdr's Unix sockets, controls host PTYs, and uses host SSH
 * tools. The Flatpak bundle therefore grants `--talk-name=org.freedesktop.Flatpak`
 * and routes every host-bound process through `flatpak-spawn --host`, which is
 * an explicit sandbox escape. All process invocation in the Electron main
 * process must go through {@link hostInvocation}; never branch on Flatpak in
 * callers.
 */
export const FLATPAK_APP_ID = 'io.github.marcelormendes.herdr-desktop';

export interface HostInvocation {
  program: string;
  args: string[];
}

export interface HostInvocationOptions {
  /**
   * Tie the host process lifetime to the application's session bus via
   * flatpak-spawn `--watch-bus`. Defaults to true for every host process the
   * application owns (commands, terminal control, SSH tunnel). The
   * intentionally detached Herdr server opts out.
   */
  watchBus?: boolean;
}

/**
 * True inside the Herdr Desktop Flatpak sandbox. Flatpak sets `FLATPAK_ID` to
 * the application ID of the running sandbox; zypak preserves it for Electron.
 */
export function isFlatpakHost(): boolean {
  return process.env.FLATPAK_ID === FLATPAK_APP_ID;
}

/**
 * The host-visible base directory that the `--filesystem=xdg-data/…` grants
 * expose on the host side. Flatpak sets `HOST_XDG_DATA_HOME` to the host's
 * real value; fall back to the conventional `~/.local/share` for older
 * runtimes.
 */
export function flatpakHostDataDir(): string {
  return process.env.HOST_XDG_DATA_HOME?.trim() || path.join(os.homedir(), '.local', 'share');
}

/** Host-side base for the `--filesystem=xdg-config/…` grants. */
export function flatpakHostConfigDir(): string {
  return process.env.HOST_XDG_CONFIG_HOME?.trim() || path.join(os.homedir(), '.config');
}

/**
 * The sandbox's own data base. Flatpak rewrites `XDG_DATA_HOME` to a private
 * location (`~/.var/app/<id>/data`) and mounts granted host `xdg-data`
 * directories at `$XDG_DATA_HOME/…` inside the sandbox — not at
 * `$HOST_XDG_DATA_HOME`.
 */
export function flatpakSandboxDataDir(): string {
  return (
    process.env.XDG_DATA_HOME?.trim() ||
    path.join(os.homedir(), '.var', 'app', FLATPAK_APP_ID, 'data')
  );
}

/** The sandbox's own config base; granted host `xdg-config` dirs mount here. */
export function flatpakSandboxConfigDir(): string {
  return (
    process.env.XDG_CONFIG_HOME?.trim() ||
    path.join(os.homedir(), '.var', 'app', FLATPAK_APP_ID, 'config')
  );
}

/**
 * Replaces a whole path prefix at a segment boundary (`prefix` itself or
 * `prefix/…`). Returns null when the path is unrelated, so a data prefix can
 * never rewrite a similarly named sibling directory.
 */
function translatePrefix(filePath: string, fromPrefix: string, toPrefix: string): string | null {
  if (filePath === fromPrefix) {
    return toPrefix;
  }
  if (filePath.startsWith(`${fromPrefix}/`)) {
    return toPrefix + filePath.slice(fromPrefix.length);
  }
  return null;
}

/**
 * Converts a sandbox-visible path to the equivalent host-visible path, or
 * returns it unchanged outside Flatpak / for unrelated prefixes. Used for
 * chat-image staging results and for the socket environment forwarded to host
 * processes.
 */
export function hostPathFromSandboxPath(filePath: string): string {
  if (!isFlatpakHost()) {
    return filePath;
  }
  return (
    translatePrefix(filePath, flatpakSandboxDataDir(), flatpakHostDataDir()) ??
    translatePrefix(filePath, flatpakSandboxConfigDir(), flatpakHostConfigDir()) ??
    filePath
  );
}

/**
 * Converts a host-visible path (for example one reported by the host `herdr`
 * CLI) to the sandbox-visible equivalent, or returns it unchanged outside
 * Flatpak / for unrelated prefixes.
 */
export function sandboxPathFromHostPath(filePath: string): string {
  if (!isFlatpakHost()) {
    return filePath;
  }
  return (
    translatePrefix(filePath, flatpakHostDataDir(), flatpakSandboxDataDir()) ??
    translatePrefix(filePath, flatpakHostConfigDir(), flatpakSandboxConfigDir()) ??
    filePath
  );
}

/**
 * Returns the program and argument array to execute for a host-bound command.
 * Outside Flatpak this is the command unchanged. Inside the Herdr Desktop
 * Flatpak it becomes
 * `flatpak-spawn --host [--watch-bus] --env=PATH=… [--env=HERDR_*_PATH=…] <program> <args...>`,
 * with the argument array preserved verbatim — never string-concatenated. The
 * explicit host PATH makes the official `~/.local/bin/herdr` and host
 * `/usr/bin/ssh` resolvable without a shell; absolute host paths (for example
 * `HERDR_DESKTOP_BIN`) pass through untouched. The Herdr socket environment
 * variables are forwarded when present so a host Herdr server can reach the
 * bridge sockets.
 */
export function hostInvocation(
  program: string,
  args: string[],
  options: HostInvocationOptions = {},
): HostInvocation {
  if (!isFlatpakHost()) {
    return { program, args };
  }
  const hostPath = `${os.homedir()}/.local/bin:/usr/local/bin:/usr/bin:/bin`;
  const flatpakArgs: string[] = ['--host'];
  if (options.watchBus !== false) {
    flatpakArgs.push('--watch-bus');
  }
  flatpakArgs.push(`--env=PATH=${hostPath}`);
  for (const name of ['HERDR_SOCKET_PATH', 'HERDR_CLIENT_SOCKET_PATH'] as const) {
    const value = process.env[name]?.trim();
    if (value) {
      flatpakArgs.push(`--env=${name}=${value}`);
    }
  }
  flatpakArgs.push(program, ...args);
  return { program: 'flatpak-spawn', args: flatpakArgs };
}

/**
 * Directory used to stage pasted/dropped chat images. Flatpak's private /tmp
 * is invisible to host agents, so inside the sandbox images must be staged in
 * the granted host-visible directory. The sandbox sees it at
 * `$XDG_DATA_HOME/herdr-desktop/chat-images` and the host at
 * `$HOST_XDG_DATA_HOME/herdr-desktop/chat-images` — two aliases of the same
 * files; staged results are translated to the host form on the way back to
 * the renderer/agent.
 */
export function chatImageStagingDir(): string {
  if (isFlatpakHost()) {
    // The sandbox XDG_DATA_HOME is where the xdg-data grant mounts the host
    // directory; staged results are translated to host-visible paths on the
    // way back to the renderer/agent.
    return path.join(flatpakSandboxDataDir(), 'herdr-desktop', 'chat-images');
  }
  return path.join(os.tmpdir(), 'herdr-desktop-chat-images');
}

/**
 * Sandbox-visible directory for the remote-engine bridge sockets in Flatpak
 * mode. The `--filesystem=xdg-data/herdr-desktop:create` parent grant mounts
 * it on both sides (this child is created 0700 by `createTcpBridge`); the
 * socket environment forwarded to host processes uses the host-equivalent
 * paths.
 */
export function flatpakRemoteSocketDir(): string {
  return path.join(flatpakSandboxDataDir(), 'herdr-desktop', 'remote');
}
