import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { RESTAURANT } from "@/lib/menu";

export const metadata: Metadata = {
  title: "Karahi House | Pickup Ordering",
  description:
    "A browser voice demo for pickup orders using South Asian dish names. Orders are simulated and require staff acceptance.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="wrap">
          <header className="site-header">
            <Link href="/" className="brand">
              <span className="brand-mark">KH</span>
              <span className="brand-name">{RESTAURANT.name}</span>
            </Link>
            <nav className="nav" aria-label="Main navigation">
              <Link href="/menu">Menu</Link>
              <Link href="/#order">Voice order</Link>
            </nav>
          </header>
          <p className="demo-status" role="status">
            {RESTAURANT.demoStatus} · Pickup requests only; staff acceptance required.
          </p>
          {children}
          <footer className="site-footer">
            <div>{RESTAURANT.name} · {RESTAURANT.address}</div>
            <div>Restaurant phone: {RESTAURANT.phone}</div>
          </footer>
        </div>
      </body>
    </html>
  );
}
