import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell, SectionLabel } from "@/components/app-shell";

export const Route = createFileRoute("/receipts")({
  head: () => ({
    meta: [
      { title: "Import receipts — Grocery Shadow" },
      {
        name: "description",
        content:
          "Upload supermarket receipts. We quietly infer your real nutrition intake.",
      },
      { property: "og:title", content: "Import receipts — Grocery Shadow" },
      {
        property: "og:description",
        content: "Drop PDFs or photos. Folder auto-detection coming.",
      },
    ],
  }),
  component: Receipts,
});

const HISTORY = [
  { store: "Whole Foods", date: "Jun 24", items: 18 },
  { store: "Trader Joe's", date: "Jun 18", items: 12 },
  { store: "Whole Foods", date: "Jun 11", items: 22 },
  { store: "Local Market", date: "Jun 04", items: 9 },
];

const DEMO_RECEIPT = {
  store: "Demo Market",
  date: "Jul 01",
  items: 14,
  lines: [
    "Organic baby spinach — 200g",
    "Greek yogurt, plain — 1kg",
    "Wild salmon fillet — 300g",
    "Red lentils — 500g",
    "Sourdough loaf — 1",
    "Bananas — 6",
    "Almond butter — 1 jar",
    "Dark chocolate 85% — 1 bar",
    "Rolled oats — 1kg",
    "Extra virgin olive oil — 500ml",
    "Free-range eggs — 12",
    "Cherry tomatoes — 500g",
    "Sparkling water — 6x",
    "Pumpkin seeds — 250g",
  ],
};

function Receipts() {
  const [analyzing, setAnalyzing] = useState(false);
  const [history, setHistory] = useState(HISTORY);
  const [demoLoaded, setDemoLoaded] = useState(false);

  function loadDemo() {
    if (demoLoaded) return;
    setAnalyzing(true);
    setTimeout(() => {
      setHistory((h) => [
        { store: DEMO_RECEIPT.store, date: DEMO_RECEIPT.date, items: DEMO_RECEIPT.items },
        ...h,
      ]);
      setDemoLoaded(true);
      setAnalyzing(false);
    }, 1400);
  }

  return (
    <AppShell>
      <section className="space-y-10 px-6 pb-16">
        <header className="space-y-2">
          <SectionLabel>Step 2 · Receipts</SectionLabel>
          <h1 className="text-balance text-4xl font-medium leading-none tracking-tight">
            Bring in your week.
          </h1>
          <p className="max-w-[56ch] text-pretty text-base text-ink/60">
            Download your supermarket receipts and drop them here. PDF or photo
            — we'll handle the rest.
          </p>
        </header>

        <button
          type="button"
          onClick={loadDemo}
          className="block w-full rounded-3xl border border-dashed border-ink/20 bg-surface p-12 text-center transition-colors hover:border-ink/40"
        >
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-zinc-100 ring-1 ring-black/5">
            <span className="text-lg text-ink/60">↑</span>
          </div>
          <p className="text-sm font-medium tracking-tight">
            Drop receipts here or click to upload
          </p>
          <p className="mt-1 text-xs text-ink/50">PDF, JPG or PNG · up to 20 MB</p>
          <p className="mt-3 text-[11px] uppercase tracking-widest text-ink/40">
            {demoLoaded ? "Demo receipt loaded" : "Click to try a demo receipt"}
          </p>
        </button>

        {analyzing ? (
          <div className="flex items-center gap-3 rounded-2xl bg-ink px-5 py-4 text-canvas">
            <span className="size-2 animate-pulse rounded-full bg-canvas" />
            <p className="text-sm font-medium tracking-tight">
              Analyzing your real nutrition intake…
            </p>
          </div>
        ) : null}

        {demoLoaded ? (
          <div className="space-y-4 rounded-2xl bg-surface p-5 ring-1 ring-black/5">
            <div className="flex items-center justify-between">
              <SectionLabel>Demo receipt · {DEMO_RECEIPT.store}</SectionLabel>
              <span className="text-xs text-ink/40">{DEMO_RECEIPT.date}</span>
            </div>
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {DEMO_RECEIPT.lines.map((line) => (
                <li key={line} className="text-sm text-ink/70">
                  · {line}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="rounded-2xl bg-surface p-5 ring-1 ring-black/5">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <SectionLabel>Folder detection</SectionLabel>
              <p className="text-sm text-ink/70">
                Auto-import receipts from your Downloads folder when they arrive.
              </p>
            </div>
            <button className="rounded-full bg-zinc-100 px-4 py-2 text-xs font-medium tracking-tight text-ink ring-1 ring-black/5">
              Enable
            </button>
          </div>
        </div>

        <div className="space-y-4">
          <SectionLabel>Recent receipts</SectionLabel>
          <ul className="divide-y divide-black/5 rounded-2xl bg-surface ring-1 ring-black/5">
            {history.map((r) => (
              <li key={`${r.store}-${r.date}`} className="flex items-center justify-between px-5 py-4">
                <div>
                  <p className="text-sm font-medium tracking-tight">{r.store}</p>
                  <p className="text-xs text-ink/50">{r.date} · {r.items} items</p>
                </div>
                <span className="text-xs text-ink/40">Analyzed</span>
              </li>
            ))}
          </ul>
        </div>

        <Link
          to="/"
          className="block rounded-2xl bg-ink px-6 py-4 text-center text-sm font-medium tracking-tight text-canvas"
        >
          See your Weekly Mirror →
        </Link>
      </section>
    </AppShell>
  );
}