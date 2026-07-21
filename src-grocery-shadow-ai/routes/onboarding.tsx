import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell, SectionLabel } from "@/components/app-shell";

export const Route = createFileRoute("/onboarding")({
  head: () => ({
    meta: [
      { title: "Build your profile — Grocery Shadow" },
      {
        name: "description",
        content:
          "Tell us a little about you so we can create your optimal nutrition profile.",
      },
      { property: "og:title", content: "Build your profile — Grocery Shadow" },
      {
        property: "og:description",
        content: "A short, quiet form. No tracking, no logging.",
      },
    ],
  }),
  component: Onboarding,
});

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-2">
      <SectionLabel>{label}</SectionLabel>
      <div>{children}</div>
    </label>
  );
}

const inputCls =
  "w-full rounded-xl bg-zinc-50 px-4 py-3 text-sm text-ink ring-1 ring-black/5 outline-none focus:ring-ink/30";

const ACTIVITY = ["Low", "Medium", "High"] as const;
const DIETS = ["Omnivore", "Vegetarian", "Vegan", "Pescatarian"] as const;

function Onboarding() {
  const [submitted, setSubmitted] = useState(false);
  const [activity, setActivity] = useState<(typeof ACTIVITY)[number]>("Medium");
  const [diet, setDiet] = useState<(typeof DIETS)[number]>("Omnivore");

  if (submitted) {
    return (
      <AppShell>
        <section className="flex min-h-[60vh] flex-col items-center justify-center gap-6 px-6 text-center">
          <span className="size-2 animate-pulse rounded-full bg-ink" />
          <h1 className="text-balance text-2xl font-medium tracking-tight">
            Your optimal nutrition profile is being created…
          </h1>
          <p className="max-w-[42ch] text-pretty text-sm text-ink/60">
            We are quietly modeling targets for protein, fiber, calories and key
            micronutrients — calibrated to your body and your week.
          </p>
          <Link
            to="/receipts"
            className="rounded-full bg-ink px-6 py-3 text-xs font-medium tracking-widest text-canvas uppercase"
          >
            Continue
          </Link>
        </section>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <section className="px-6 pb-16">
        <header className="mb-10 space-y-2">
          <SectionLabel>Step 1 of 3</SectionLabel>
          <h1 className="text-balance text-4xl font-medium leading-none tracking-tight">
            About you
          </h1>
          <p className="max-w-[56ch] text-pretty text-base text-ink/60">
            A few quiet details. Used only to model your optimal nutrition.
          </p>
        </header>

        <form
          className="space-y-8 rounded-3xl bg-surface p-6 ring-1 ring-black/5"
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(true);
          }}
        >
          <div className="grid gap-6 sm:grid-cols-3">
            <Field label="Age">
              <input className={inputCls} type="number" defaultValue={32} min={13} max={100} />
            </Field>
            <Field label="Sex">
              <select className={inputCls} defaultValue="female">
                <option value="female">Female</option>
                <option value="male">Male</option>
                <option value="other">Other</option>
              </select>
            </Field>
            <Field label="Height (cm)">
              <input className={inputCls} type="number" defaultValue={170} />
            </Field>
            <Field label="Weight (kg)">
              <input className={inputCls} type="number" defaultValue={68} />
            </Field>
            <Field label="Allergies">
              <input className={inputCls} placeholder="e.g. peanuts, lactose" />
            </Field>
            <Field label="Dietary preference">
              <select
                className={inputCls}
                value={diet}
                onChange={(e) => setDiet(e.target.value as (typeof DIETS)[number])}
              >
                {DIETS.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
            </Field>
          </div>

          <div className="space-y-3">
            <SectionLabel>Activity level</SectionLabel>
            <div className="flex gap-2">
              {ACTIVITY.map((a) => (
                <button
                  type="button"
                  key={a}
                  onClick={() => setActivity(a)}
                  className={
                    "flex-1 rounded-xl py-3 text-sm font-medium tracking-tight transition-colors ring-1 " +
                    (activity === a
                      ? "bg-ink text-canvas ring-ink"
                      : "bg-zinc-50 text-ink/60 ring-black/5 hover:text-ink")
                  }
                >
                  {a}
                </button>
              ))}
            </div>
          </div>

          <Field label="Supermarket visits per week (on average)">
            <input
              className={inputCls}
              type="number"
              defaultValue={2}
              min={0}
              max={14}
              step={1}
            />
            <p className="mt-2 text-xs text-ink/50">
              Helps us tune granularity — more frequent shoppers get finer
              weekly resolution.
            </p>
          </Field>

          <div className="rounded-2xl bg-zinc-50 p-4 ring-1 ring-black/5">
            <SectionLabel>A quick note</SectionLabel>
            <p className="mt-2 text-sm text-ink/70">
              Grocery Shadow currently works best for individuals. A shared
              household mode — with per-person distribution and waste
              tracking — is planned for a future release.
            </p>
          </div>

          <button
            type="submit"
            className="w-full rounded-2xl bg-ink px-6 py-4 text-sm font-medium tracking-tight text-canvas"
          >
            Create my profile
          </button>
        </form>
      </section>
    </AppShell>
  );
}