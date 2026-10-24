// The LLM selects approved FAQ/gap-fill wording. Order facts always come from
// deterministic templates. An exact allowlist also catches paraphrased claims
// that a numeric/keyword guard alone cannot reliably recognize.
export const GAP_REPLIES = [
  "Could you say that again?",
  "What would you like to know about the menu?",
  "The team will need to confirm that detail.",
  "Would you prefer a vegetarian dish?",
  "Which dishes sound good to you?",
];

export function isSafeLlmSay(say: string): boolean {
  if (/[\p{N}$\u20ac\u00a3]/u.test(say)) return false;
  return !/\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|hundred|thousand|million|dozen|couple|pair|double|triple|half|full|single|ek|aik|do|teen|chaar|paanch|subtotal|total|quantity|qty|portion|price|cost|dollars?|rupees?|free|added|adding|removed|removing|updated|changed|confirmed|accepted|placed|ordered|cancelled|canceled|charged|ready|saved|booked|reserved)\b|\byour order\b/i.test(say);
}
