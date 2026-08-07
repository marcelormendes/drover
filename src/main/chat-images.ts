import { chmodSync, lstatSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  CHAT_IMAGE_EXTENSIONS,
  type ChatImageDraft,
  isCanonicalBase64,
  MAX_CHAT_IMAGE_ATTACHMENTS,
  MAX_CHAT_IMAGE_BYTES,
  MAX_CHAT_IMAGE_TOTAL_BYTES,
} from '@/shared/desktop-api';

const STALE_IMAGE_AGE_MS = 24 * 60 * 60 * 1000;

function validExtension(extension: string): string {
  const normalized = extension.toLocaleLowerCase();
  if (!(CHAT_IMAGE_EXTENSIONS as readonly string[]).includes(normalized)) {
    throw new Error(`Unsupported image extension '${extension}'.`);
  }
  return normalized;
}

function decodePayload(data: string): Buffer {
  if (data.length === 0) {
    throw new Error('Chat image payload is empty.');
  }
  if (!isCanonicalBase64(data)) {
    throw new Error('Chat image payload is not valid canonical base64.');
  }
  const bytes = Buffer.from(data, 'base64');
  if (bytes.length === 0) {
    throw new Error('Chat image payload is empty.');
  }
  if (bytes.length > MAX_CHAT_IMAGE_BYTES) {
    throw new Error(
      `Chat image payload exceeds the ${MAX_CHAT_IMAGE_BYTES / 1024 / 1024} MiB limit.`,
    );
  }
  return bytes;
}

/**
 * The staging directory is desktop-owned and holds pasted images, so it must
 * not be a symlink or a file placed by another local user, and it must stay
 * readable only by the current user.
 */
function ensureStagingDir(dir: string): void {
  let info: ReturnType<typeof lstatSync>;
  try {
    info = lstatSync(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32') {
      chmodSync(dir, 0o700);
    }
    return;
  }
  if (!info.isDirectory()) {
    throw new Error(`Chat image staging path is not a directory: ${dir}`);
  }
  if (typeof process.getuid === 'function' && info.uid !== process.getuid()) {
    throw new Error(`Chat image staging directory is not owned by the current user: ${dir}`);
  }
  if (process.platform !== 'win32') {
    chmodSync(dir, 0o700);
  }
}

function writeUniqueFile(dir: string, name: string, extension: string, data: Buffer): string {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const path = join(dir, `${name}-${attempt}.${extension}`);
    try {
      writeFileSync(path, data, { flag: 'wx', mode: 0o600 });
      return path;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') {
        throw error;
      }
    }
  }
  throw new Error('Failed to allocate a unique chat image staging path.');
}

/** Removes only stale regular files; symlinks and directories are left alone. */
function removeStaleFiles(dir: string): void {
  const cutoff = Date.now() - STALE_IMAGE_AGE_MS;
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    try {
      const info = lstatSync(path);
      if (info.isFile() && info.mtimeMs < cutoff) {
        rmSync(path, { force: true });
      }
    } catch {
      // A concurrent cleanup may have removed the entry already.
    }
  }
}

/**
 * Writes chat image payloads to a desktop-owned staging directory and returns
 * the absolute path of each staged file. The agent receives these paths as
 * bracketed pastes, mirroring how Herdr itself bridges clipboard images: the
 * agent CLI reads the file and attaches it to the conversation.
 */
export function stageChatImages(dir: string, drafts: ChatImageDraft[]): string[] {
  if (drafts.length > MAX_CHAT_IMAGE_ATTACHMENTS) {
    throw new Error(`Chat image batch exceeds the ${MAX_CHAT_IMAGE_ATTACHMENTS} attachment limit.`);
  }
  const decoded = drafts.map((draft) => ({
    extension: validExtension(draft.extension),
    data: decodePayload(draft.data),
  }));
  const totalBytes = decoded.reduce((sum, item) => sum + item.data.length, 0);
  if (totalBytes > MAX_CHAT_IMAGE_TOTAL_BYTES) {
    throw new Error(
      `Chat image batch exceeds the ${MAX_CHAT_IMAGE_TOTAL_BYTES / 1024 / 1024} MiB total limit.`,
    );
  }
  ensureStagingDir(dir);
  removeStaleFiles(dir);
  const paths: string[] = [];
  for (let index = 0; index < decoded.length; index += 1) {
    const item = decoded[index];
    paths.push(
      writeUniqueFile(dir, `herdr-desktop-chat-${Date.now()}-${index}`, item.extension, item.data),
    );
  }
  return paths;
}
