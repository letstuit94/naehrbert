import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell, SectionLabel } from "@/components/app-shell";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Weekly Mirror — Grocery Shadow" },
      {
        name: "description",
        content:
          "A reflection of your shopping habits against your optimal nutrition profile.",
      },
      { property: "og:title", content: "Weekly Mirror — Grocery Shadow" },
      {
        property: "og:description",
        content: "See your current nutrition inferred from groceries.",
      },
    ],
  }),
  component: Mirror,
});

type Metric = {
  name: string;
  current: number;
  optimal: number;
  unit: string;
  status: "low" | "ok" | "high";
  note: string;
};

const METRICS: Metric[] = [
  { name: "Protein", current: 42, optimal: 56, unit: "g", status: "low", note: "−14g gap" },
  { name: "Fiber", current: 22, optimal: 30, unit: "g", status: "low", note: "−8g gap" },
  { name: "Sugar", current: 88, optimal: 45, unit: "g", status: "high", note: "High" },
  { name: "Calories", current: 2100, optimal: 2250, unit: "kcal", status: "ok", note: "Balanced" },
  { name: "Iron", current: 9, optimal: 14, unit: "mg", status: "low", note: "Low" },
  { name: "Magnesium", current: 280, optimal: 380, unit: "mg", status: "low", note: "Low" },
];

const INSIGHTS = [
  {
    title: "Add a plant protein anchor",
    body: "A bag of lentils or tofu closes most of your protein gap in one swap.",
  },
  {
    title: "Swap one sweet drink for sparkling water",
    body: "Single biggest lever on your sugar surplus this week.",
  },
  {
    title: "Pick up dark leafy greens",
    body: "Spinach or chard lifts iron and magnesium together.",
  },
];

function alignmentColor(closeness: number) {
  // closeness: 0 (far) → 1 (perfect). Interpolate red → amber → green via HSL hue.
  const hue = Math.round(closeness * 130); // 0 red, 130 green
  return `hsl(${hue} 65% 45%)`;
}

function MetricRow({ m }: { m: Metric }) {
  // Closeness to optimum: 1 when current == optimal, decays as you drift either way.
  const ratio = m.current / m.optimal;
  const closeness = Math.max(0, 1 - Math.abs(1 - ratio));
  const fillPct = Math.min(ratio, 1.2) / 1.2 * 100;
  const color = alignmentColor(closeness);
  return (
    <div className="space-y-2 py-3">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium tracking-tight">{m.name}</span>
        <span className="text-xs tabular-nums text-ink/50">
          {m.current}
          <span className="text-ink/30"> / {m.optimal} {m.unit}</span>
        </span>
      </div>
      <div className="relative h-2.5 overflow-hidden rounded-full bg-zinc-200/70">
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all"
          style={{ width: `${fillPct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

function Mirror() {
  const score = 72;
  return (
    <AppShell>
      <section className="px-6 pb-12">
        <div className="flex flex-col gap-10">
          <header className="space-y-2">
            <SectionLabel>Week 24 · 4 receipts</SectionLabel>
            <h1 className="text-balance text-4xl font-medium leading-none tracking-tight">
              Weekly Mirror
            </h1>
          </header>

          <div className="rounded-3xl bg-surface p-8 ring-1 ring-black/5">
            <SectionLabel>Alignment score</SectionLabel>
            <div className="mt-3 flex items-baseline gap-3">
              <span className="text-7xl font-medium leading-none tracking-tight">
                {score}
              </span>
              <span className="text-lg text-ink/40">/ 100</span>
            </div>
            <p className="mt-4 text-pretty text-base leading-relaxed text-ink/70">
              Great improvement from last week — you're up 12 points, driven by
              less sugar and more fiber.
            </p>
          </div>

          <div className="space-y-4">
            <SectionLabel>Focus next trip</SectionLabel>
            <ol className="divide-y divide-black/5 rounded-2xl bg-surface ring-1 ring-black/5">
              {INSIGHTS.map((i, idx) => (
                <li key={i.title} className="flex gap-4 px-5 py-4">
                  <span className="mt-0.5 text-xs tabular-nums text-ink/40">
                    0{idx + 1}
                  </span>
                  <div className="space-y-1">
                    <p className="text-sm font-medium tracking-tight">{i.title}</p>
                    <p className="text-sm leading-relaxed text-ink/60">{i.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div className="space-y-4">
            <SectionLabel>Tracked nutrition</SectionLabel>
            <div className="divide-y divide-black/5 rounded-2xl bg-surface px-5 ring-1 ring-black/5">
              {METRICS.map((m) => (
                <MetricRow key={m.name} m={m} />
              ))}
            </div>
          </div>

          <Link
            to="/plan"
            className="block rounded-2xl bg-ink px-6 py-5 text-center text-sm font-medium tracking-tight text-canvas transition-transform hover:-translate-y-0.5"
          >
            See your optimized next cart →
          </Link>
        </div>
      </section>
    </AppShell>
  );
}
