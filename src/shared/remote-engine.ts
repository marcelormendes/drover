export type RemoteEngineState = 'off' | 'starting' | 'connected' | 'error';

/** The client forward uses the TCP port immediately after the API forward. */
export const REMOTE_CLIENT_PORT_OFFSET = 1;
export const MAX_REMOTE_ENGINE_PORT = 65535 - REMOTE_CLIENT_PORT_OFFSET;

export function remoteClientPort(port: number): number {
  return port + REMOTE_CLIENT_PORT_OFFSET;
}

export interface RemoteEngineStatus {
  state: RemoteEngineState;
  host: string;
  port: number;
  /** Local Unix socket the tunnel exposes; also the HERDR_SOCKET_PATH value. */
  socketPath?: string;
  /** Local Unix socket for Herdr terminal control; also HERDR_CLIENT_SOCKET_PATH. */
  clientSocketPath?: string;
  message?: string;
}

export interface RemoteEngineTarget {
  enabled: boolean;
  host: string;
  port: number;
}
