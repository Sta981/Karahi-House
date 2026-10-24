import { TEXT_CASES } from "./text-cases.mjs";

// Supplemental human-authored labels for protein words that were present in
// the utterances but unannotated in Day 1. The frozen corpus stays unchanged.
// Each array follows expected.items order. Other missing fields mean explicitly
// unspecified, not a wildcard; dish IDs already distinguish fixed-protein items.
const PROTEINS = {
  "canonical-05": ["Chicken"], "canonical-06": ["Beef"],
  "canonical-08": ["Chicken"], "canonical-09": ["Beef"],
  "canonical-10": ["Chicken"], "canonical-11": ["Paneer"],
  "canonical-12": ["Paneer"], "canonical-15": ["Goat"],
  "aliases-07": ["Chicken"], "aliases-08": ["Paneer"],
  "aliases-12": ["Paneer"], "aliases-13": ["Goat"],
  "code_switch-11": [null, "Chicken"], "code_switch-12": ["Goat", null],
  "order_slots-02": ["Chicken"], "order_slots-10": ["Chicken", null],
  "order_slots-19": ["Paneer", null], "order_slots-20": ["Chicken", null],
};

export const STRICT_SLOT_CASES = TEXT_CASES.filter((row) => row.expected.disposition === "match").map((row) => ({
  id: row.id,
  text: row.text,
  split: "development",
  items: row.expected.items.map((item, index) => ({
    itemId: item.itemId,
    qty: item.qty,
    protein: item.protein ?? PROTEINS[row.id]?.[index] ?? null,
    portion: item.portion ?? null,
  })),
}));

export const exactSlots = (items) => items.map((item) => ({
  itemId: item.itemId, qty: item.qty, protein: item.protein ?? null, portion: item.portion ?? null,
}));
