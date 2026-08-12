import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { HerdrApiClient, type HerdrApiError } from '@/main/herdr/api-client';

const cleanupDirectories: string[] = [];
const cleanupServers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupServers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
  await Promise.all(
    cleanupDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

async function socketServer(
  onRequest: (request: Record<string, unknown>) => Record<string, unknown>,
): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'drover-api-'));
  const socketPath = path.join(directory, 'api.sock');
  cleanupDirectories.push(directory);

  const server = createServer((socket) => {
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline === -1) {
        return;
      }
      const request = JSON.parse(buffer.slice(0, newline)) as Record<string, unknown>;
      socket.end(`${JSON.stringify(onRequest(request))}\n`);
    });
  });
  cleanupServers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, resolve);
  });
  return socketPath;
}

describe('HerdrApiClient', () => {
  it('frames a raw Herdr request and returns its result', async () => {
    const socketPath = await socketServer((request) => {
      expect(request).toMatchObject({
        method: 'workspace.focus',
        params: { workspace_id: 'w2' },
      });
      expect(request.id).toEqual(expect.stringMatching(/^desktop:/));
      return {
        id: request.id,
        result: { type: 'workspace_info', workspace: { workspace_id: 'w2' } },
      };
    });

    const result = await new HerdrApiClient().request(socketPath, 'workspace.focus', {
      workspace_id: 'w2',
    });

    expect(result).toEqual({ type: 'workspace_info', workspace: { workspace_id: 'w2' } });
  });

  it('turns Herdr error envelopes into useful exceptions', async () => {
    const socketPath = await socketServer((request) => ({
      id: request.id,
      error: { code: 'not_found', message: 'workspace not found' },
    }));

    await expect(
      new HerdrApiClient().request(socketPath, 'workspace.focus', { workspace_id: 'w404' }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<HerdrApiError>>({
        name: 'HerdrApiError',
        code: 'not_found',
        message: 'workspace not found',
      }),
    );
  });
});
