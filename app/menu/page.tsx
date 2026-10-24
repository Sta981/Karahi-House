import { CATEGORIES, MENU, RESTAURANT } from "@/lib/menu";

export const metadata = { title: "Menu | Karahi House" };

export default function MenuPage() {
  return (
    <main>
      <section className="hero" style={{ paddingBottom: 8 }}>
        <h1 style={{ fontSize: "clamp(30px, 4vw, 44px)" }}>The Menu</h1>
        <p className="lede">
          {RESTAURANT.tagline} · {RESTAURANT.address} · {RESTAURANT.phone}
        </p>
        <p>{RESTAURANT.demoStatus}</p>
      </section>
      {CATEGORIES.map((cat) => {
        const items = MENU.filter((m) => m.category === cat);
        if (!items.length) return null;
        return (
          <div className="menu-cat" key={cat}>
            <h3>{cat}</h3>
            <div className="menu-items">
              {items.map((item) => (
                <div className="menu-item" key={item.id}>
                  <div>
                    <div className="name">
                      {item.name}
                    </div>
                    {item.description && <div className="desc">{item.description}</div>}
                    {item.size && (
                      <div className="variants">
                        Half ${(item.price_cents / 100).toFixed(2)} · Full ${((item.price_cents + item.size.Full) / 100).toFixed(2)}
                        {!item.size_verified && " · Size surcharge unverified"}
                      </div>
                    )}
                    {item.spice && <div className="variants">Spice selection required</div>}
                  </div>
                  {!item.size && <div className="price">${(item.price_cents / 100).toFixed(2)}</div>}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </main>
  );
}
