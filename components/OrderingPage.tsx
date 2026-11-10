import MenuOrdering from "@/components/MenuOrdering";
import StoreHeader from "@/components/StoreHeader";
import StreamingVoice from "@/components/StreamingVoice";

export default function OrderingPage() {
  return (
    <main>
      <StoreHeader />
      <div className="menu-layout">
        <MenuOrdering />
        <aside className="voice-sticky" id="order" aria-label="Order by voice">
          <StreamingVoice compact />
        </aside>
      </div>
    </main>
  );
}
