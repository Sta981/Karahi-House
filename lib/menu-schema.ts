export interface MenuItem {
  id: string; name: string; website_name?: string; category: string;
  family?: string; protein?: string; price_cents: number; spice: boolean;
  size?: { Half: number; Full: number }; size_verified?: boolean;
  description?: string; description_ai?: boolean; includes?: string[];
  aliases: string[];
}
export interface MenuSource {
  schema_version: number; status: string; currency: string; price_unit: string;
  modifiers: {
    spice_level: { required: boolean; choose: number; options: string[] };
    size: { required: boolean; choose: number; options: string[] };
    notes: { required: boolean; type: string };
    quantity: { required: boolean; default: number };
  };
  items: Omit<MenuItem, "aliases">[];
}
export function validateMenu(source: MenuSource) {
  const require = (valid: boolean, message: string) => { if (!valid) throw new Error(`Invalid final menu: ${message}`); };
  require(source.schema_version === 1 && source.currency === "USD", "schema/currency");
  require(Array.isArray(source.items) && source.items.length === 84, "expected 84 items");
  require(new Set(source.items.map(item => item.id)).size === 84, "duplicate IDs");
  for (const item of source.items) {
    require(/^[A-Z][A-Z0-9_]*$/.test(item.id) && Boolean(item.name && item.category), "item identity");
    require(Number.isSafeInteger(item.price_cents) && item.price_cents >= 0, `${item.id} price must be integer cents`);
    require(typeof item.spice === "boolean", `${item.id} spice flag`);
    if (item.size) {
      require(Object.keys(item.size).sort().join() === "Full,Half", `${item.id} size options`);
      require(item.size.Half === 0 && Number.isSafeInteger(item.size.Full) && item.size.Full >= 0, `${item.id} size surcharge must be integer cents`);
      require(typeof item.size_verified === "boolean", `${item.id} size verification`);
    }
  }
  const sized = source.items.filter(item => item.size).length;
  const spicy = source.items.filter(item => item.spice).length;
  require(sized === 13 && spicy === 66, "expected 13 sized and 66 spice-enabled items");
  const { spice_level, size, notes, quantity } = source.modifiers;
  require(spice_level.required && spice_level.choose === 1 && spice_level.options.length === 5 && new Set(spice_level.options).size === 5, "five required spice options");
  require(size.required && size.choose === 1 && size.options.join() === "Half,Full", "required Half/Full options");
  require(!notes.required && notes.type === "free_text" && quantity.required && quantity.default === 1, "notes/quantity defaults");
  return { items: source.items.length, uniqueIds: new Set(source.items.map(item => item.id)).size,
    sizedItems: sized, spiceItems: spicy, integerCentPrices: source.items.length,
    spiceOptions: spice_level.options.length, unverifiedSizes: source.items.filter(item => item.size && !item.size_verified).length };
}
export function unitPriceCents(item: MenuItem, size?: "Half" | "Full"): number {
  if (item.size && !size) throw new Error("Size required before pricing");
  if (!item.size && size) throw new Error("This item has no size modifier");
  return item.price_cents + (item.size && size ? item.size[size] : 0);
}
