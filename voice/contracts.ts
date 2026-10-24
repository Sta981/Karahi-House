// Audio transports depend on this contract; the order engine has no audio imports.
export type SttModel = "flux" | "nova-3" | "nova-3-en-IN";
export type SttEvent = { type: "speech" } | { type: "partial"; text: string } |
  { type: "final"; text: string; audioEndSeconds: number | null; endpointReason?: string } | { type: "error"; code: string; closeCode?: number } | {type:"configuration";accepted:boolean};
export interface SttStream { send(pcm: Buffer): void; close(): void; configureKeyterms?(terms:string[]):void }
export interface Tts { name: string; warm(): Promise<void>; speak(text: string, signal: AbortSignal): AsyncIterable<Buffer>; close(): void; plan?(text: string): { firstByteCached: boolean; cachedSegments: number; dynamicCharacters: number;acknowledgementBytes?:number } }
export type Emit = (event: Record<string, unknown> | Buffer) => void;
