export type RemoteEngineState = 'off' | 'starting' | 'connected' | 'error';

export interface RemoteEngineStatus {
  state: RemoteEngineState;
  host: string;
  port: number;
  /** Local Unix socket the tunnel exposes; also the HERDR_SOCKET_PATH value. */
  socketPath?: string;
  message?: string;
}

export interface RemoteEngineTarget {
  enabled: boolean;
  host: string;
  port: number;
}
