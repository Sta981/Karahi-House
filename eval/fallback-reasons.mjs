// Historical original-matcher diagnostics; the six gaps are now handled locally.
// Explanations of the six observed routing gaps, not reasons an LLM is essential.
// The frozen routing evaluator starts every row in a new, open conversation.
export const FALLBACK_REASONS = {
  "negative-01": 'The greeting pattern accepts "hello" alone, not "hello there"; no dish or FAQ intent matched.',
  "negative-02": "There is no local thanks/acknowledgment handler.",
  "negative-05": 'Name extraction only runs in ask_name; this isolated case starts in open.',
  "negative-06": "There is no local callback-number capture intent or callback collection phase.",
  "negative-09": "There is no pickup-availability FAQ handler; pickup parsing only runs in ask_type.",
  "negative-10": 'The done pattern covers "that would be all" and "that\'ll be all", but misses "that will be all".',
};
