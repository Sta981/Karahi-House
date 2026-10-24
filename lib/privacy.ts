// Used on logs, evaluation output and optional model context. Conversation state
// can retain a callback number, but it must not be printed or sent to the LLM.
export function redactPhoneNumbers(text: string): string {
  return text.replace(/\+?\d(?:[\s().-]*\d){6,}/g, "[phone redacted]");
}
