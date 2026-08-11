import {
  MAX_CHAT_IMAGE_ATTACHMENTS,
  MAX_CHAT_IMAGE_BYTES,
  MAX_CHAT_IMAGE_TOTAL_BYTES,
} from '@/shared/desktop-api';

export const IMAGE_EXTENSION_BY_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
};

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'gif', 'webp', 'bmp']);

export interface ChatAttachment {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly blob: Blob;
  readonly extension: string;
}

export function imageExtension(file: File): string | undefined {
  const fromType = IMAGE_EXTENSION_BY_TYPE[file.type];
  if (fromType) {
    return fromType;
  }
  const match = /\.([a-z0-9]+)$/i.exec(file.name);
  if (match) {
    const extension = match[1].toLocaleLowerCase();
    if (extension === 'jpeg') {
      return 'jpg';
    }
    if (IMAGE_EXTENSIONS.has(extension)) {
      return extension;
    }
  }
  return undefined;
}

export function imageFiles(dataTransfer: DataTransfer | null): File[] {
  if (!dataTransfer) {
    return [];
  }
  const files: File[] = [];
  for (const item of Array.from(dataTransfer.items ?? [])) {
    if (item.kind === 'file') {
      const file = item.getAsFile();
      if (file && imageExtension(file)) {
        files.push(file);
      }
    }
  }
  if (files.length === 0) {
    for (const file of Array.from(dataTransfer.files ?? [])) {
      if (imageExtension(file)) {
        files.push(file);
      }
    }
  }
  return files;
}

export function readBlobAsBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the image.'));
    reader.readAsDataURL(blob);
  });
}

export function imageReference(index: number): string {
  return `[Image #${index + 1}]`;
}

export interface ImageAcceptance {
  readonly accepted: ChatAttachment[];
  readonly skippedForCount: number;
  readonly skippedForSize: number;
}

/**
 * Validates and bounds pasted/dropped image files against the shared chat
 * attachment limits. Callers own the returned object URLs and must revoke
 * them when the attachment is removed.
 */
export function acceptImageFiles(
  files: File[],
  existing: readonly ChatAttachment[],
): ImageAcceptance {
  let totalBytes = existing.reduce((sum, attachment) => sum + attachment.blob.size, 0);
  const accepted: ChatAttachment[] = [];
  let skippedForCount = 0;
  let skippedForSize = 0;
  for (const file of files) {
    const extension = imageExtension(file);
    if (!extension) {
      continue;
    }
    if (file.size === 0 || file.size > MAX_CHAT_IMAGE_BYTES) {
      skippedForSize += 1;
      continue;
    }
    if (
      existing.length + accepted.length >= MAX_CHAT_IMAGE_ATTACHMENTS ||
      totalBytes + file.size > MAX_CHAT_IMAGE_TOTAL_BYTES
    ) {
      skippedForCount += 1;
      continue;
    }
    accepted.push({
      id: `${file.name}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      name: file.name,
      url: URL.createObjectURL(file),
      blob: file,
      extension,
    });
    totalBytes += file.size;
  }
  return { accepted, skippedForCount, skippedForSize };
}

export function attachmentNoticeFor(
  skippedForSize: number,
  skippedForCount: number,
  attempted: number,
): string | undefined {
  if (skippedForSize > 0) {
    return `Images must be between 1 byte and ${MAX_CHAT_IMAGE_BYTES / 1024 / 1024} MiB.`;
  }
  if (skippedForCount > 0) {
    return skippedForCount === attempted
      ? 'Image limit reached — remove an attachment to add more.'
      : 'Some images were skipped because the attachment limit was reached.';
  }
  return undefined;
}
