// Author-created wrong-word ASR simulations, not real speech/transcripts or a
// claim about how any group speaks. Known development data; never held out.
const item = (itemId, qty = 1, protein = null, portion = null) => ({ itemId, qty, protein, portion });
const rows = [
  ["one chicken karahi", "one chicken Kirby", [item("lahori-karahi", 1, "Chicken")]],
  ["one half chicken karahi", "one half chicken curry", [item("lahori-karahi", 1, "Chicken", "half")]],
  ["two beef seekh kebab", "two beef sick cabob", [item("beef-seekh-kebab", 2, "Beef")]],
  ["one full goat shinwari karahi", "one goat shin worry karahi full", [item("shinwari-karahi", 1, "Goat", "full")]],
  ["two garlic naan", "two garlic non", [item("garlic-naan", 2)]],
  ["three plain naan", "three plain none", [item("plain-naan", 3)]],
  ["one butter chicken", "one butter kitchen", [item("butter-tikka-masala", 1, "Chicken")]],
  ["one palak paneer", "one palak pan here", [item("saag-paneer", 1, null)]],
  ["two dal makhani", "two doll makhani", [item("dal-makhani", 2)]],
  ["one chana masala", "one channel masala", [item("chana-masala")]],
  ["one aloo gobi", "one alloo goby", [item("aloo-gobi")]],
  ["two mango lassi", "two mango lassie", [item("mango-lassi", 2)]],
  ["one gulab jamun", "one gulab german", [item("gulab-jamun")]],
  ["one rasmalai", "one rush malai", [item("rasmalai")]],
  ["two veggie samosa", "two veggie some osa", [item("veggie-samosa", 2)]],
  ["one fish pakora", "one fish park aura", [item("fish-pakora")]],
  ["one chicken biryani and two garlic naan", "one chicken biryani and too garlic naan", [item("chicken-biryani", 1, "Chicken"), item("garlic-naan", 2)]],
  ["four roti", "for roti", [item("roti", 4)]],
  ["one half chicken white karahi", "won half chicken white karahi", [item("white-karahi", 1, "Chicken", "half")]],
  ["three plain naan", "tree plain naan", [item("plain-naan", 3)]],
];
export const SIMULATED_STT_CASES = rows.map(([intended, text, items], index) => ({
  id: `simulated-${String(index + 1).padStart(2, "0")}`, simulated: true, split: "development",
  source: "synthetic_stt_simulation", intended, text, items,
}));
