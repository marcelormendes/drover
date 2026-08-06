export interface HerdrEventEnvelope {
  event: string;
  data: Record<string, unknown>;
}

export type HerdrEventConnectionState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected';
