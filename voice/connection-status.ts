// Only bounded codes/messages leave the transport; never echo provider payloads.
export function sttCloseError(closeCode: number, reason: string) {
  return { type: "error" as const, code: /NET-0001/.test(reason) ? "stt_audio_timeout" : /DATA-0000/.test(reason) ? "stt_invalid_audio" : "stt_disconnected", closeCode };
}
export function voiceErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    voice_busy: "A voice call is already open in another tab. End that call, then try again.",
    stt_audio_timeout: "Deepgram stopped receiving microphone audio. Check your microphone, then start again.",
    stt_invalid_audio: "Deepgram rejected the microphone audio. Start again; if it repeats, report this message.",
    stt_disconnected: "The speech recognition connection ended. Start the microphone again to reconnect.",
    stt_connection_failed: "Could not reach Deepgram. Check your connection and try again.",
    stt_provider_error: "Deepgram reported a recognition error. Check the key, credits and selected model.",
    stt_audio_backpressure: "Microphone audio could not reach Deepgram fast enough. Reconnect on a steadier network.",
    access_denied: "The hosted demo access code is incorrect.",
    tts_failed: "Voice output failed. Read the reply below; your microphone and order are still active. You can keep speaking.",
  };
  return messages[code] || `Voice error: ${code}`;
}
export function recoverableVoiceError(code: string): boolean { return code === "tts_failed"; }
