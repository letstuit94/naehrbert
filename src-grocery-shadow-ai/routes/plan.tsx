import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell, SectionLabel } from "@/components/app-shell";

export const Route = createFileRoute("/plan")({
  head: () => ({
    meta: [
      { title: "Your next cart — Grocery Shadow" },
      {
        name: "description",
        content:
          "Plan the meals you'll actually cook this week — we'll build the cart for you.",
      },
      { property: "og:title", content: "Your next cart — Grocery Shadow" },
      {
        property: "og:description",
        content: "Pick a few recipes. Get one quiet shopping list.",
      },
    ],
  }),
  component: Plan,
});

type Cuisine =
  | "Mediterranean"
  | "Asian bowls"
  | "Comfort classics"
  | "Plant-forward"
  | "High-protein"
  | "Quick weeknight";

const CUISINES: Cuisine[] = [
  "Mediterranean",
  "Asian bowls",
  "Comfort classics",
  "Plant-forward",
  "High-protein",
  "Quick weeknight",
];

type Recipe = {
  id: string;
  name: string;
  time: string;
  tags: Cuisine[];
  blurb: string;
  items: string[];
};

const RECIPES: Recipe[] = [
  { id: "r1", name: "Lemon herb salmon with spinach", time: "25 min", tags: ["Mediterranean", "High-protein"], blurb: "Omega-3, iron, and greens in one pan.", items: ["Wild salmon", "Baby spinach", "Lemon", "Olive oil", "Garlic"] },
  { id: "r2", name: "Red lentil dal with brown rice", time: "35 min", tags: ["Plant-forward", "Comfort classics"], blurb: "Fiber-rich, budget-friendly, freezes well.", items: ["Red lentils", "Brown rice", "Onion", "Ginger", "Tomato", "Cumin"] },
  { id: "r3", name: "Miso tofu grain bowl", time: "30 min", tags: ["Asian bowls", "Plant-forward"], blurb: "Fermented miso + complete plant protein.", items: ["Firm tofu", "Miso paste", "Brown rice", "Edamame", "Scallion", "Sesame"] },
  { id: "r4", name: "Chickpea shakshuka", time: "25 min", tags: ["Mediterranean", "Plant-forward"], blurb: "Iron and fiber in a rich tomato bath.", items: ["Chickpeas", "Eggs", "Canned tomato", "Bell pepper", "Paprika"] },
  { id: "r5", name: "Sheet-pan chicken & broccoli", time: "30 min", tags: ["High-protein", "Quick weeknight"], blurb: "Lean protein and cruciferous veg, one tray.", items: ["Chicken thighs", "Broccoli", "Olive oil", "Lemon", "Garlic"] },
  { id: "r6", name: "Soba noodle salad", time: "20 min", tags: ["Asian bowls", "Quick weeknight"], blurb: "Buckwheat noodles, magnesium boost.", items: ["Soba noodles", "Cucumber", "Carrot", "Peanut butter", "Soy sauce"] },
  { id: "r7", name: "White bean & kale soup", time: "35 min", tags: ["Mediterranean", "Comfort classics"], blurb: "Deeply savory, plant protein, calcium from kale.", items: ["White beans", "Kale", "Onion", "Garlic", "Parmesan rind"] },
  { id: "r8", name: "Greek yogurt breakfast bowls", time: "5 min", tags: ["Quick weeknight", "High-protein"], blurb: "Protein-forward mornings, no cooking.", items: ["Greek yogurt", "Berries", "Pumpkin seeds", "Oats"] },
  { id: "r9", name: "Roasted squash farro bowl", time: "40 min", tags: ["Plant-forward", "Mediterranean"], blurb: "Whole grain + roasted veg + herby dressing.", items: ["Butternut squash", "Farro", "Feta", "Parsley", "Olive oil"] },
];

function Plan() {
  const [cookCount, setCookCount] = useState<number>(4);
  const [interests, setInterests] = useState<Cuisine[]>(["Mediterranean", "Plant-forward"]);
  const [suggested, setSuggested] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cartReady, setCartReady] = useState(false);

  const suggestions = useMemo(() => {
    if (!suggested) return [];
    const pool = RECIPES.filter((r) =>
      interests.length === 0 ? true : r.tags.some((t) => interests.includes(t)),
    );
    const target = Math.min(cookCount * 3, RECIPES.length);
    // fall back to all recipes if pool too small
    const base = pool.length >= target ? pool : RECIPES;
    return base.slice(0, target);
  }, [suggested, interests, cookCount]);

  const cart = useMemo(() => {
    const map = new Map<string, number>();
    RECIPES.filter((r) => selected.has(r.id)).forEach((r) => {
      r.items.forEach((it) => map.set(it, (map.get(it) ?? 0) + 1));
    });
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [selected]);

  const toggleInterest = (c: Cuisine) =>
    setInterests((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c],
    );

  const toggleRecipe = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < cookCount) next.add(id);
      return next;
    });

  return (
    <AppShell>
      <section className="space-y-10 px-6 pb-12">
        <header className="space-y-2">
          <SectionLabel>Next shopping trip</SectionLabel>
          <h1 className="text-balance text-4xl font-medium leading-none tracking-tight">
            Plan meals. We&apos;ll write the list.
          </h1>
          <p className="max-w-[56ch] text-pretty text-base text-ink/60">
            Tell us how much you want to cook and what you&apos;re in the mood
            for. We&apos;ll suggest recipes, then turn your picks into a single
            quiet cart.
          </p>
        </header>

        <div className="space-y-4 rounded-2xl bg-surface p-5 ring-1 ring-black/5">
          <SectionLabel>How many home-cooked meals this week?</SectionLabel>
          <div className="flex flex-wrap gap-2">
            {[2, 3, 4, 5, 6, 7].map((n) => (
              <button
                key={n}
                onClick={() => {
                  setCookCount(n);
                  setSelected(new Set());
                  setCartReady(false);
                }}
                className={
                  "min-w-12 rounded-xl px-4 py-3 text-sm font-medium tracking-tight transition-colors ring-1 " +
                  (cookCount === n
                    ? "bg-ink text-canvas ring-ink"
                    : "bg-zinc-50 text-ink/60 ring-black/5 hover:text-ink")
                }
              >
                {n}
              </button>
            ))}
          </div>
          <p className="text-sm text-ink/60">
            We&apos;ll suggest {cookCount * 3} recipes so you can pick your
            favorite {cookCount}.
          </p>
        </div>

        <div className="space-y-4 rounded-2xl bg-surface p-5 ring-1 ring-black/5">
          <SectionLabel>What are you into right now?</SectionLabel>
          <div className="flex flex-wrap gap-2">
            {CUISINES.map((c) => {
              const active = interests.includes(c);
              return (
                <button
                  key={c}
                  onClick={() => {
                    toggleInterest(c);
                    setCartReady(false);
                  }}
                  className={
                    "rounded-full px-4 py-2 text-xs font-medium tracking-tight transition-colors ring-1 " +
                    (active
                      ? "bg-ink text-canvas ring-ink"
                      : "bg-zinc-50 text-ink/60 ring-black/5 hover:text-ink")
                  }
                >
                  {c}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-ink/50">Pick a few — or leave blank for a mix.</p>
        </div>

        <button
          onClick={() => {
            setSuggested(true);
            setSelected(new Set());
            setCartReady(false);
          }}
          className="w-full rounded-2xl bg-ink px-6 py-4 text-sm font-medium tracking-tight text-canvas"
        >
          {suggested ? "Refresh suggestions" : "Suggest recipes"}
        </button>
      </section>

      {suggested ? (
        <section className="space-y-8 rounded-t-[32px] bg-zinc-900 px-6 py-16 text-zinc-100">
          <header className="space-y-2">
            <SectionLabel>
              <span className="text-zinc-400">Step 2 — pick {cookCount}</span>
            </SectionLabel>
            <h2 className="text-balance text-2xl font-medium leading-tight tracking-tight">
              Choose your {cookCount} recipes
            </h2>
            <p className="max-w-[56ch] text-pretty text-sm text-zinc-400">
              {selected.size} of {cookCount} selected. We&apos;ll fold the
              ingredients into one cart.
            </p>
          </header>

          <div className="grid gap-3 sm:grid-cols-2">
            {suggestions.map((r) => {
              const isSel = selected.has(r.id);
              const full = !isSel && selected.size >= cookCount;
              return (
                <button
                  key={r.id}
                  onClick={() => toggleRecipe(r.id)}
                  disabled={full}
                  className={
                    "flex flex-col gap-2 rounded-2xl p-4 text-left ring-1 transition-colors " +
                    (isSel
                      ? "bg-zinc-100 text-zinc-950 ring-zinc-100"
                      : full
                        ? "bg-white/[0.03] text-zinc-500 ring-white/10 cursor-not-allowed"
                        : "bg-white/5 text-zinc-100 ring-white/10 hover:bg-white/10")
                  }
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-sm font-medium leading-snug">{r.name}</span>
                    <span
                      className={
                        "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest " +
                        (isSel ? "bg-zinc-950 text-zinc-100" : "bg-white/10 text-zinc-400")
                      }
                    >
                      {isSel ? "picked" : r.time}
                    </span>
                  </div>
                  <p className={"text-xs " + (isSel ? "text-zinc-600" : "text-zinc-400")}>
                    {r.blurb}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {r.tags.map((t) => (
                      <span
                        key={t}
                        className={
                          "rounded-full px-2 py-0.5 text-[10px] " +
                          (isSel
                            ? "bg-zinc-200 text-zinc-700"
                            : "bg-white/5 text-zinc-500")
                        }
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>

          <button
            disabled={selected.size !== cookCount}
            onClick={() => setCartReady(true)}
            className={
              "w-full rounded-xl px-6 py-4 text-sm font-medium tracking-tight ring-1 transition-colors " +
              (selected.size === cookCount
                ? "bg-zinc-100 text-zinc-950 ring-zinc-100"
                : "bg-white/5 text-zinc-500 ring-white/10 cursor-not-allowed")
            }
          >
            {selected.size === cookCount
              ? "Build my cart"
              : `Select ${cookCount - selected.size} more`}
          </button>

          {cartReady ? (
            <div className="space-y-4 rounded-2xl bg-zinc-800/50 p-6">
              <div className="flex items-baseline justify-between">
                <p className="text-xs font-medium uppercase tracking-widest text-zinc-500">
                  Your cart
                </p>
                <p className="text-xs text-zinc-500">
                  {cart.length} items · {selected.size} meals
                </p>
              </div>
              <ul className="divide-y divide-white/5">
                {cart.map(([name, count]) => (
                  <li
                    key={name}
                    className="flex items-center justify-between py-2.5 text-sm"
                  >
                    <span className="text-zinc-100">{name}</span>
                    {count > 1 ? (
                      <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                        ×{count}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
              <button className="w-full rounded-xl bg-zinc-100 px-6 py-4 text-sm font-medium tracking-tight text-zinc-950">
                Send to my shopping list
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
    </AppShell>
  );
}