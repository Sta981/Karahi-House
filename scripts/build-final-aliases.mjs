import { readFileSync, writeFileSync } from "node:fs";
// Rebuilt only from final source names and these reviewed spelling equivalents.
// No earlier menu/alias file is read.
const { items } = JSON.parse(readFileSync("lib/menu-source.json", "utf8"));
const extra = {
  BRAINS_KARAHI: ["maghaz", "mughaz", "brains", "maghaz karahi"],
  FISH_KARAHI: ["machli karahi"], FISH_PAKORA: ["fish pakoda", "machli pakora"],
  DAL_MAKHANI: ["daal makhni"],
  CHANA_MASALA: ["cholay", "chole", "channay"], ALOO_GOBI: ["alu gobhi"],
  KARAHI_PANEER: ["paneer karahi", "kadai paneer"],
  VEGETABLE_BIRYANI: ["veg biryani", "veggie biryani", "sabzi biryani"],
  GARLIC_NAAN_BREAD: ["lehsan naan", "lahsun naan"],
  PLAIN_NAAN_BREAD: ["naan", "plain naan"], ROTI: ["chapathi", "chapati", "roti bread"],
  VEG_SAMOSAS: ["samosa", "samosay", "veggie samosa", "veg samosa"],
  GULAB_JAMUN: ["gulab jaman"], RASMALAI: ["ras malai"], PAPADAM: ["papad", "papadum", "papadam"],
  KIDS_FRIES: ["french fries", "fries"], RICE: ["plain rice"],
  SWEET_YOGURT_LASSI: ["sweet lassi"], SALTY_YOGURT_LASSI: ["salt lassi", "salty lassi"],
  SODA_CAN: ["soda", "can of soda"], CHICKEN_LEG_OR_BREAST: ["chicken leg", "chicken breast"],
};
const substitutions = { chicken: ["chikan", "chiken", "murgh"], karahi: ["kadai", "kadhai", "kadahi", "kirby"],
  shinwari: ["shinvari"], kabab: ["kebab", "kabob"], biryani: ["briyani", "biriyani"],
  lassi: ["lasi", "lassie"], dal: ["daal"], naan: ["nan"], saag: ["sag"] };
const aliases = Object.fromEntries(items.map(item => {
  const labels = new Set([item.name.toLowerCase(), item.website_name?.toLowerCase(), ...(extra[item.id] ?? [])].filter(Boolean));
  if (item.name.endsWith(" Bread")) labels.add(item.name.toLowerCase().replace(/ bread$/, ""));
  if (item.family && item.protein) {
    labels.add(`${item.protein} ${item.family}`.toLowerCase());
    labels.add(`${item.family} ${item.protein}`.toLowerCase());
    if (item.family === "Shinwari Karahi") labels.add(`shinwari ${item.protein}`.toLowerCase());
    if (item.family === "Karahi Black Pepper") {
      labels.add(`${item.protein} black pepper karahi`.toLowerCase());
      labels.add(`kali mirch ${item.protein} karahi`.toLowerCase());
    }
  }
  for (const label of [...labels]) {
    let variants = [""];
    for (const word of label.split(/\s+/)) variants = variants.flatMap(prefix => [word, ...(substitutions[word] ?? [])].map(choice => `${prefix} ${choice}`.trim()));
    for (const variant of variants) labels.add(variant);
    if (label.includes("seekh kabab")) {
      for (const phrase of ["seek kabob", "sick cabob", "sikh kebab"]) labels.add(label.replace("seekh kabab", phrase));
    }
  }
  return [item.id, [...labels].sort()];
}));
writeFileSync("lib/menu-aliases.json", JSON.stringify(aliases, null, 2) + "\n");
console.log(`Built separate aliases for ${items.length} final-source IDs; no legacy inputs.`);
