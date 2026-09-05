import { randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';

export class HerdrApiError extends Error {
  override readonly name = 'HerdrApiError';

  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

interface HerdrSuccessEnvelope {
  id: string;
  result: unknown;
}

interface HerdrErrorEnvelope {
  id: string;
  error: { code: string; message: string };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseEnvelope(line: string, requestId: string): HerdrSuccessEnvelope | HerdrErrorEnvelope {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new HerdrApiError('invalid_response', 'Herdr returned invalid JSON.');
  }

  if (!isRecord(value) || value.id !== requestId) {
    throw new HerdrApiError('invalid_response', 'Herdr returned an unexpected response.');
  }

  if (isRecord(value.error)) {
    const { code, message } = value.error;
    if (typeof code === 'string' && typeof message === 'string') {
      return { id: requestId, error: { code, message } };
    }
  }

  if ('result' in value) {
    return { id: requestId, result: value.result };
  }

  throw new HerdrApiError('invalid_response', 'Herdr returned an unexpected response.');
}

export class HerdrApiClient {
  constructor(private readonly timeoutMs = 45_000) {}

  request(socketPath: string, method: string, params: unknown): Promise<unknown> {
    const requestId = `desktop:${randomUUID()}`;

    return new Promise((resolve, reject) => {
      const socket = createConnection(socketPath);
      const chunks: string[] = [];
      let settled = false;

      const finish = (callback: () => void) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        socket.destroy();
        callback();
      };

      const timeout = setTimeout(() => {
        finish(() => reject(new HerdrApiError('timeout', 'Herdr did not respond in time.')));
      }, this.timeoutMs);
      timeout.unref();

      socket.setEncoding('utf8');
      socket.once('connect', () => {
        socket.write(`${JSON.stringify({ id: requestId, method, params })}\n`);
      });
      socket.on('data', (chunk: string) => {
        if (settled) {
          return;
        }
        // Search each fragment once; rescanning the accumulated response makes
        // large, fragmented conversation pages quadratic in their byte length.
        const newline = chunk.indexOf('\n');
        if (newline === -1) {
          chunks.push(chunk);
          return;
        }
        chunks.push(chunk.slice(0, newline));

        try {
          const envelope = parseEnvelope(chunks.join(''), requestId);
          if ('error' in envelope) {
            finish(() => reject(new HerdrApiError(envelope.error.code, envelope.error.message)));
          } else {
            finish(() => resolve(envelope.result));
          }
        } catch (error) {
          finish(() => reject(error));
        }
      });
      socket.once('error', (error) => finish(() => reject(error)));
      socket.once('end', () => {
        if (!settled) {
          finish(() =>
            reject(
              new HerdrApiError(
                'empty_response',
                'Herdr closed the connection without a response.',
              ),
            ),
          );
        }
      });
    });
  }
}
