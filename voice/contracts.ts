// Audio transports depend on this contract; the order engine has no audio imports.
export type SttModel = "flux" | "nova-3" | "nova-3-en-IN";
export const NOVA_MULTILINGUAL_LANGUAGE_HINTS=["en","hi"] as const;
export type SttEvent = { type: "speech" } | { type: "partial"; text: string } |
  { type: "final"; text: string; audioEndSeconds: number | null; endpointReason?: string; continuationOf?:string;fragment?:string } | { type: "error"; code: string; closeCode?: number } | {type:"configuration";accepted:boolean};
export interface SttStream { send(pcm: Buffer): void; close(): void; configureKeyterms?(terms:string[]):void }
export type TtsTelemetry={type:"attempt_start"|"transport"|"headers"|"raw_chunk"|"attempt_end"|"retry"|"segment"|"jitter_ready"|"stall"|"terminal_failure";atMs?:number;gapMs?:number;bytes?:number;attempt?:number;part?:number;totalMs?:number;firstByteMs?:number;chunks?:number;reused?:boolean;ok?:boolean;reason?:"timeout"|"connection"|"http"|"aborted";phase?:"dns"|"tcp"|"tls";kind?:"neutral"|"informative";bufferedMs?:number;wholeShortReply?:boolean};
export type TtsObserver=(event:TtsTelemetry)=>void;
export interface Tts { name: string; warm(): Promise<void>; speak(text: string, signal: AbortSignal,observe?:TtsObserver): AsyncIterable<Buffer>; close(): void; plan?(text: string): { firstByteCached: boolean; cachedSegments: number; dynamicCharacters: number;acknowledgementBytes?:number } }
export type Emit = (event: Record<string, unknown> | Buffer) => void;
