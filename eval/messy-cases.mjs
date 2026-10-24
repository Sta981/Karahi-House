// New development scenarios, authored before their first execution. These are
// deliberately separate from the frozen corpus and are never called held out.
const line = (itemId, qty = 1, variantLabel = null) => ({ itemId, qty, variantLabel });
export const MESSY_CASES = [
  { id: "messy-01", tags: ["typo"], turns: [
    { text: "two garlik naan", cart: [], clarification: true },
    { text: "garlic naan", cart: [line("garlic-naan", 2)] },
  ] },
  { id: "messy-02", tags: ["typo"], turns: [
    { text: "one chiken biriyani", cart: [line("chicken-biryani")] },
  ] },
  { id: "messy-03", tags: ["typo", "code-switch", "portion"], turns: [
    { text: "aik aadha chikan lahori kadai", cart: [line("lahori-karahi", 1, "Chicken \u00b7 Half")] },
  ] },
  { id: "messy-04", tags: ["typo", "quantity"], turns: [
    { text: "do beef seek kabob plz", cart: [line("beef-seekh-kebab", 2)] },
  ] },
  { id: "messy-05", tags: ["code-switch", "quantity"], turns: [
    { text: "bhai mujhe teen roti dena", cart: [line("roti", 3)] },
  ] },
  { id: "messy-06", tags: ["code-switch", "portion"], turns: [
    { text: "ek poora goat shinwari karahi chahiye", cart: [line("shinwari-karahi", 1, "Goat \u00b7 Full")] },
  ] },
  { id: "messy-07", tags: ["typo", "code-switch", "two-items"], turns: [
    { text: "do garlik naan aur aik mango lassi", cart: [], clarification: true },
    { text: "garlic naan", cart: [line("garlic-naan", 2), line("mango-lassi")] },
  ] },
  { id: "messy-08", tags: ["code-switch", "two-items", "portion"], turns: [
    { text: "one half chicken white karahi and teen plain naan please", cart: [line("white-karahi", 1, "Chicken \u00b7 Half"), line("plain-naan", 3)] },
  ] },
  { id: "messy-09", tags: ["quantity-correction", "multi-turn"], turns: [
    { text: "one garlic naan", cart: [line("garlic-naan")] },
    { text: "no, make it two", cart: [line("garlic-naan", 2)] },
  ] },
  { id: "messy-10", tags: ["quantity-correction", "two-items", "multi-turn"], turns: [
    { text: "one half chicken lahori karahi and one garlic naan", cart: [line("lahori-karahi", 1, "Chicken \u00b7 Half"), line("garlic-naan")] },
    { text: "no, make it two garlic naan", cart: [line("lahori-karahi", 1, "Chicken \u00b7 Half"), line("garlic-naan", 2)] },
  ] },
];
