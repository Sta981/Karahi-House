// Freeze these pseudonymous speaker assignments before collecting recordings.
// Speaker identities, demographics and consent records belong only in /.data/.
export const RECORDING_PLAN = {
  version: 1,
  targetSpeakers: 5,
  targetUtterances: 100,
  retentionDays: 30,
  speakers: [
    { id: "s01", split: "development" },
    { id: "s02", split: "development" },
    { id: "s03", split: "development" },
    { id: "s04", split: "held_out" },
    { id: "s05", split: "held_out" },
  ],
};

const item = (itemId, qty = 1, fields = {}) => ({ itemId, qty, ...fields });
const prompts = [
  ["Can I get one half chicken Lahori karahi please?", [item("lahori-karahi", 1, { protein: "Chicken", portion: "half" })]],
  ["One full goat Shinwari karahi please.", [item("shinwari-karahi", 1, { protein: "Goat", portion: "full" })]],
  ["One half lamb white karahi please.", [item("white-karahi", 1, { protein: "Lamb", portion: "half" })]],
  ["Two beef seekh kebab please.", [item("beef-seekh-kebab", 2, { protein: "Beef" })]],
  ["One chicken seekh kebab and two garlic naan.", [item("chicken-seekh-kebab"), item("garlic-naan", 2)]],
  ["Mujhe do garlic naan chahiye.", [item("garlic-naan", 2)]],
  ["Aik chicken biryani aur teen roti.", [item("chicken-biryani"), item("roti", 3)]],
  ["One paneer tikka masala please.", [item("paneer-tikka-masala")]],
  ["Could I have fish pakora please?", [item("fish-pakora")]],
  ["Two mutton biryani please.", [item("goat-biryani", 2)]],
  ["One dal makhani and one saag paneer.", [item("dal-makhani"), item("saag-paneer")]],
  ["Two mango lassi and one gulab jamun.", [item("mango-lassi", 2), item("gulab-jamun")]],
  ["One butter chicken and two plain naan.", [item("butter-tikka-masala"), item("plain-naan", 2)]],
  ["One chicken sixty five and two plain rice.", [item("chicken-65"), item("plain-rice", 2)]],
  ["Aik aloo gobi aur chaar roti please.", [item("aloo-gobi"), item("roti", 4)]],
];

export const RECORDING_PROMPTS = prompts.map(([text, items], index) => ({
  id: `p${String(index + 1).padStart(2, "0")}`, text, expected: { disposition: "match", items },
}));
RECORDING_PROMPTS.push(
  { id: "p16", text: "Can I get paneer tikka?", expected: { disposition: "clarify", candidates: ["paneer-tikka-masala"] } },
  { id: "p17", text: "Do you have pakoda?", expected: { disposition: "clarify", candidates: ["fish-pakora"] } },
  { id: "p18", text: "I would like chapli kabab please.", expected: { disposition: "unavailable" } },
  { id: "p19", text: "Can I speak to a person please?", expected: { disposition: "ignore" }, note: "Matcher has no menu entity; conversation must separately offer callback." },
  { id: "p20", text: "I have a peanut allergy. Can someone help?", expected: { disposition: "ignore" }, note: "Matcher has no menu entity; conversation must separately escalate allergy questions." },
);
