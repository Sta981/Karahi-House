import VoiceDemo from "@/components/VoiceDemo";
import { RESTAURANT } from "@/lib/menu";

const EXAMPLES: [string, string][] = [
  ["chikan kadai", "Ask which chicken karahi style"],
  ["seek kabob", "Ask which protein"],
  ["mutton biryani", "Ask goat or lamb"],
  ["gulab jaman", "Gulab Jamun"],
  ["do garlic nan", "2 × Garlic Naan"],
  ["butter chicken", "Offer a listed alternative"],
];

export default function Home() {
  return (
    <main>
      <section className="hero">
        <div className="hero-badge">Built for {RESTAURANT.name} · Polk Street, San Francisco</div>
        <p>{RESTAURANT.demoStatus}</p>
        <h1>
          Your phone, <em>answered.</em>
        </h1>
        <p className="lede">
          Every call picked up. Every accent understood. Every order written down and handed to you, while your
          hands stay on the karahi.
        </p>
        <div className="cta-row">
          <a className="btn btn-primary" href="#demo">
            ▶ Hear it work
          </a>
          <a className="btn btn-ghost" href="/menu">
            See the menu
          </a>
        </div>
      </section>

      <VoiceDemo />

      <section className="section">
        <div className="grid-3">
          <div className="panel feature">
            <div className="value-icon">📞</div>
            <h4>Never miss a call</h4>
            <p>
              It answers instantly: during the lunch rush, at closing, or at 1 AM on a Saturday. No hold, no
              voicemail, no lost order.
            </p>
          </div>
          <div className="panel feature">
            <div className="value-icon">🗣️</div>
            <h4>Understands every customer</h4>
            <p>
              &quot;Kadai&quot;, &quot;seekh kabob&quot;, &quot;mutton biryani&quot;, said in any accent, even mixed
              with Urdu. It knows your menu the way your customers say it.
            </p>
          </div>
          <div className="panel feature">
            <div className="value-icon">🧾</div>
            <h4>The order, in your hand</h4>
            <p>
              Every call ends as a clean slip: the items, the total, the customer&apos;s name, pickup or delivery.
              Nothing to write down, nothing to mishear.
            </p>
          </div>
        </div>
      </section>

      <section className="section">
        <h2>It speaks your menu</h2>
        <p className="sub">However the customer says it, the right dish lands on the ticket.</p>
        <div className="hu-grid">
          {EXAMPLES.map(([heard, matched], i) => (
            <div className="hu-item" key={i}>
              <span className="hu-heard">“{heard}”</span>
              <span className="hu-arrow">→</span>
              <span className="hu-matched">{matched}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="panel closer">
          <h2>Ready when you are</h2>
          <p className="sub" style={{ marginBottom: 0 }}>
            It connects to the restaurant&apos;s existing phone number with simple call forwarding: customers dial
            {" "}{RESTAURANT.phone} like always, and the assistant takes it from there.
          </p>
        </div>
      </section>
    </main>
  );
}
