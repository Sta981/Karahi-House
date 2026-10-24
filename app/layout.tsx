import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { RESTAURANT } from "@/lib/menu";

export const metadata: Metadata = {
  title: "Karahi House | Voice AI Receptionist",
  description:
    "An accent-robust voice AI agent for Karahi House SF: takes phone orders, answers menu and hours questions, and actually understands South Asian dish names and accents.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="wrap">
          <header className="site-header">
            <Link href="/" style={{ textDecoration: "none", color: "inherit" }}>
              <div className="brand">
                <div className="brand-mark">🦚</div>
                <div>
                  <div className="brand-name">Karahi House</div>
                  <div className="brand-sub">Voice AI Receptionist</div>
                </div>
              </div>
            </Link>
            <nav className="nav">
              <Link href="/">Live Demo</Link>
              <Link href="/voice">Streaming Voice</Link>
              <Link href="/menu">Menu</Link>
              <a href="https://github.com/haidergillani/Karahi-House" target="_blank" rel="noreferrer">GitHub</a>
            </nav>
          </header>
          <p role="status">{RESTAURANT.demoStatus} · Pickup requests only; staff acceptance required.</p>
          {children}
          <footer className="site-footer">
            <div>
              {RESTAURANT.name} · {RESTAURANT.address} · {RESTAURANT.phone}
            </div>
            <div>Halal ✓ · Dine-In · Takeout · Delivery · Catering</div>
          </footer>
        </div>
      </body>
    </html>
  );
}
