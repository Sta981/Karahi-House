import { RESTAURANT } from "@/lib/menu";

export default function StoreHeader() {
  const etaMinutes = RESTAURANT.pickupEtaSource.match(/\d+/)?.[0];

  return (
    <section className="store-header" aria-labelledby="store-title">
      <div className="store-heading-row">
        <div>
          <h1 id="store-title">{RESTAURANT.name}</h1>
          <div className="store-details">
            <span>{RESTAURANT.address}</span>
            <a href={`tel:${RESTAURANT.phone.replace(/[^\d+]/g, "")}`}>
              Restaurant phone: {RESTAURANT.phone}
            </a>
          </div>
        </div>
        <div className="store-badges">
          <span className="pill">Pickup</span>
          {etaMinutes && <span>About {etaMinutes} min</span>}
        </div>
      </div>
    </section>
  );
}
