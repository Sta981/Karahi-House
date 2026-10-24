// Additional known synthetic routing checks, separate from the frozen 100-case
// extraction corpus. These expectations are not LLM-answer quality labels.
export const ROUTING_SCENARIOS = [
  { id: "greeting", turns: [{ text: "hello", route: "local" }] },
  { id: "hours", turns: [{ text: "what time do you close", route: "local" }] },
  { id: "address", turns: [{ text: "where are you located", route: "local" }] },
  { id: "price", turns: [{ text: "how much is garlic naan", route: "local" }] },
  { id: "allergy", turns: [{ text: "I have a peanut allergy", route: "local" }] },
  { id: "staff", turns: [{ text: "I need to speak to staff", route: "local" }] },
  { id: "recommendation", turns: [{ text: "what do you recommend", route: "llm_needed" }] },
  { id: "dish-description", turns: [{ text: "what is in white karahi", route: "llm_needed" }] },
  { id: "unknown-policy", turns: [{ text: "may I bring my own drinks", route: "llm_needed" }] },
  { id: "small-talk", turns: [{ text: "thank you very much", route: "local" }] },
  { id: "parking", turns: [{ text: "is there parking nearby", route: "llm_needed" }] },
  { id: "unrecognized", turns: [{ text: "zzzz qqqq", route: "llm_needed" }] },
  { id: "paneer-confirmation", turns: [
    { text: "two paneer tikka", route: "local" },
    { text: "yes", route: "local" },
  ] },
  { id: "variant-confirmation", turns: [
    { text: "chicken karahi", route: "local" },
    { text: "half", route: "local" },
  ] },
  { id: "checkout-collection", turns: [
    { text: "2 garlic naan", route: "local" },
    { text: "that's all", route: "local" },
    { text: "Ahmed", route: "local" },
    { text: "pickup", route: "local" },
  ] },
];
