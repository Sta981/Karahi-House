"use client";

import { useEffect, useMemo, useState } from "react";
import { CATEGORIES, MENU, MODIFIERS, unitPriceCents, type MenuItem } from "@/lib/menu";

function formatPrice(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function categoryId(category: string) {
  return `menu-${category.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

export default function MenuOrdering() {
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState(CATEGORIES[0] ?? "");
  const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null);
  const [size, setSize] = useState<"Half" | "Full">("Half");
  const [spice, setSpice] = useState(MODIFIERS.spice_level.options[0] ?? "");
  const [quantity, setQuantity] = useState(MODIFIERS.quantity.default);
  const [notes, setNotes] = useState("");

  const itemsByCategory = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return CATEGORIES.map((category) => ({
      category,
      items: MENU.filter((item) => {
        if (item.category !== category) return false;
        if (!normalizedQuery) return true;
        return `${item.name} ${item.category} ${item.description ?? ""}`.toLowerCase().includes(normalizedQuery);
      }),
    })).filter(({ items }) => items.length > 0);
  }, [query]);
  const visibleItemCount = itemsByCategory.reduce((count, group) => count + group.items.length, 0);

  useEffect(() => {
    if (!selectedItem) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedItem(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selectedItem]);

  function openItem(item: MenuItem) {
    setSelectedItem(item);
    setSize("Half");
    setSpice(MODIFIERS.spice_level.options[0] ?? "");
    setQuantity(MODIFIERS.quantity.default);
    setNotes("");
  }

  function selectCategory(category: string) {
    setActiveCategory(category);
    const scrollToCategory = () => document.getElementById(categoryId(category))?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (query.trim()) {
      setQuery("");
      window.requestAnimationFrame(scrollToCategory);
    } else {
      scrollToCategory();
    }
  }

  return (
    <section className="menu-column" aria-labelledby="menu-heading">
      <div className="menu-title-row">
        <h2 id="menu-heading">Our Menu</h2>
        <span className="menu-item-count">{visibleItemCount} items</span>
      </div>
      <label className="visually-hidden" htmlFor="menu-search">Search the menu</label>
      <input
        id="menu-search"
        className="menu-search"
        type="search"
        placeholder="Search dishes"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <nav className="category-chips" aria-label="Menu categories">
        {CATEGORIES.map((category) => (
          <button
            className={`category-chip${activeCategory === category ? " active" : ""}`}
            key={category}
            type="button"
            aria-pressed={activeCategory === category}
            onClick={() => selectCategory(category)}
          >
            {category}
          </button>
        ))}
      </nav>
      {itemsByCategory.length ? itemsByCategory.map(({ category, items }) => (
        <section className="menu-cat" id={categoryId(category)} key={category} aria-labelledby={`${categoryId(category)}-title`}>
          <h3 id={`${categoryId(category)}-title`}>{category}</h3>
          <div className="menu-items">
            {items.map((item) => (
              <button className="menu-item" key={item.id} type="button" onClick={() => openItem(item)}>
                <span className="menu-item-copy">
                  <span className="name">{item.name}</span>
                  {item.description && <span className="desc">{item.description}</span>}
                </span>
                <span className="price">
                  {item.size ? `From ${formatPrice(item.price_cents)}` : formatPrice(item.price_cents)}
                </span>
              </button>
            ))}
          </div>
        </section>
      )) : <p className="menu-empty">No dishes match your search.</p>}

      {selectedItem && (
        <div className="modal-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setSelectedItem(null);
        }}>
          <section className="item-modal" role="dialog" aria-modal="true" aria-labelledby="item-modal-title">
            <div className="modal-header">
              <div>
                <h2 id="item-modal-title">{selectedItem.name}</h2>
                <p className="modal-price">
                  {formatPrice(unitPriceCents(selectedItem, selectedItem.size ? size : undefined))}
                </p>
              </div>
              <button className="modal-close" type="button" aria-label="Close item details" onClick={() => setSelectedItem(null)}>
                ×
              </button>
            </div>
            {selectedItem.description && <p className="modal-description">{selectedItem.description}</p>}

            {selectedItem.size && (
              <fieldset className="modifier-group">
                <legend className="modifier-heading">
                  <span>Size</span><span className="required-pill">Required</span>
                </legend>
                {MODIFIERS.size.options.map((option) => {
                  const selectedSize = option as "Half" | "Full";
                  const delta = selectedItem.size?.[selectedSize] ?? 0;
                  return (
                    <label className="modifier-option" key={option}>
                      <input type="radio" name="item-size" value={option} checked={size === option} onChange={() => setSize(selectedSize)} />
                      <span>{option}</span>
                      <span className="option-price">{delta ? `+ ${formatPrice(delta)}` : formatPrice(selectedItem.price_cents)}</span>
                    </label>
                  );
                })}
              </fieldset>
            )}

            {selectedItem.spice && (
              <fieldset className="modifier-group">
                <legend className="modifier-heading">
                  <span>Spice Level</span><span className="required-pill">Required</span>
                </legend>
                {MODIFIERS.spice_level.options.map((option) => (
                  <label className="modifier-option" key={option}>
                    <input type="radio" name="item-spice" value={option} checked={spice === option} onChange={() => setSpice(option)} />
                    <span>{option}</span>
                  </label>
                ))}
              </fieldset>
            )}

            <div className="modifier-group">
              <label className="modifier-heading" htmlFor="item-notes">Notes</label>
              <textarea
                className="modal-notes"
                id="item-notes"
                placeholder="E.g. no green onions"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </div>

            <div className="quantity-control" role="group" aria-label="Quantity">
              <span>Quantity</span>
              <button type="button" aria-label="Decrease quantity" disabled={quantity <= 1} onClick={() => setQuantity((value) => Math.max(1, value - 1))}>−</button>
              <span aria-live="polite">{quantity}</span>
              <button type="button" aria-label="Increase quantity" onClick={() => setQuantity((value) => value + 1)}>+</button>
            </div>
            <button className="btn btn-primary modal-add" type="button" disabled>Add</button>
            <p className="modal-hint">Order by voice</p>
          </section>
        </div>
      )}
    </section>
  );
}
