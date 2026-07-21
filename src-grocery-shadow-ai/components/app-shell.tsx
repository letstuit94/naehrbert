import { Link, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";

const NAV = [
  { to: "/", label: "Mirror" },
  { to: "/plan", label: "Next Cart" },
  { to: "/receipts", label: "Receipts" },
  { to: "/progress", label: "Progress" },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="min-h-screen bg-canvas font-sans text-ink antialiased selection:bg-ink/10">
      <nav className="mx-auto flex max-w-3xl items-center justify-between px-6 py-8">
        <Link to="/" className="flex items-center gap-3">
          <span className="size-5 rounded-full bg-ink" />
          <span className="text-sm font-medium tracking-tight">Grocery Shadow</span>
        </Link>
        <div className="hidden gap-1 rounded-full bg-surface p-1 ring-1 ring-black/5 sm:flex">
          {NAV.map((item) => {
            const active =
              item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={
                  "rounded-full px-3 py-1.5 text-xs font-medium tracking-tight transition-colors " +
                  (active ? "bg-ink text-canvas" : "text-ink/55 hover:text-ink")
                }
              >
                {item.label}
              </Link>
            );
          })}
        </div>
        <Link
          to="/onboarding"
          className="text-xs font-medium tracking-tight text-ink/60 hover:text-ink"
        >
          Profile
        </Link>
      </nav>
      <main className="mx-auto max-w-3xl">{children}</main>
      <footer className="mx-auto max-w-3xl px-6 py-12 text-[11px] uppercase tracking-widest text-ink/35">
        Grocery Shadow · a quiet mirror for your cart
      </footer>
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <span className="text-xs font-medium uppercase tracking-widest text-ink/40">
      {children}
    </span>
  );
}
