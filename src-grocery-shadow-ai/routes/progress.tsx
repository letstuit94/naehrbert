import { createFileRoute } from "@tanstack/react-router";
import { AppShell, SectionLabel } from "@/components/app-shell";

export const Route = createFileRoute("/progress")({
  head: () => ({
    meta: [
      { title: "Your progress — Grocery Shadow" },
      {
        name: "description",
        content: "Nutrition alignment score and weekly improvement trend.",
      },
      { property: "og:title", content: "Your progress — Grocery Shadow" },
      {
        property: "og:description",
        content: "A quiet view of where your cart is heading.",
      },
    ],
  }),
  component: Progress,
});

const WEEKS = [54, 58, 61, 60, 67, 72, 78, 84];
const TIMELINE = [
  { week: "Week 24", note: "+12 alignment · sugar down", store: "Whole Foods" },
  { week: "Week 23", note: "+6 alignment · protein steady", store: "Trader Joe's" },
  { week: "Week 22", note: "+4 alignment · fiber added", store: "Whole Foods" },
  { week: "Week 21", note: "Baseline established", store: "Local Market" },
];

function Progress() {
  const score = WEEKS[WEEKS.length - 1];
  const max = 100;
  return (
    <AppShell>
      <section className="space-y-10 px-6 pb-16">
        <header className="space-y-2">
          <SectionLabel>Loop</SectionLabel>
          <h1 className="text-balance text-4xl font-medium leading-none tracking-tight">
            Your alignment, over time.
          </h1>
          <p className="max-w-[56ch] text-pretty text-base text-ink/60">
            How close your weekly basket sits to your optimal profile.
          </p>
        </header>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-3 rounded-2xl bg-surface p-6 ring-1 ring-black/5 sm:col-span-1">
            <SectionLabel>Alignment score</SectionLabel>
            <div className="flex items-baseline gap-2">
              <span className="text-5xl font-medium tracking-tight">{score}</span>
              <span className="text-sm text-ink/40">/ 100</span>
            </div>
            <p className="text-xs text-ink/60">+12 since last month</p>
          </div>
          <div className="space-y-4 rounded-2xl bg-surface p-6 ring-1 ring-black/5 sm:col-span-2">
            <SectionLabel>Weekly trend</SectionLabel>
            <div className="flex h-28 items-end gap-2">
              {WEEKS.map((w, i) => (
                <div
                  key={i}
                  className={
                    "flex-1 origin-bottom rounded-md " +
                    (i === WEEKS.length - 1 ? "bg-ink" : "bg-zinc-200")
                  }
                  style={{ height: `${(w / max) * 100}%` }}
                />
              ))}
            </div>
            <div className="flex justify-between text-[10px] text-ink/40">
              <span>8 weeks ago</span>
              <span>this week</span>
            </div>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 rounded-2xl bg-surface p-5 ring-1 ring-black/5">
            <SectionLabel>Streak</SectionLabel>
            <p className="text-2xl font-medium tracking-tight">4 weeks improving</p>
            <p className="text-xs text-ink/55">Quiet, consistent gains.</p>
          </div>
          <div className="space-y-2 rounded-2xl bg-surface p-5 ring-1 ring-black/5">
            <SectionLabel>Biggest shift</SectionLabel>
            <p className="text-2xl font-medium tracking-tight">Sugar −36%</p>
            <p className="text-xs text-ink/55">Vs. your first month.</p>
          </div>
        </div>

        <div className="space-y-4">
          <SectionLabel>Receipt timeline</SectionLabel>
          <ol className="divide-y divide-black/5 rounded-2xl bg-surface ring-1 ring-black/5">
            {TIMELINE.map((t) => (
              <li key={t.week} className="flex items-center justify-between px-5 py-4">
                <div>
                  <p className="text-sm font-medium tracking-tight">{t.week}</p>
                  <p className="text-xs text-ink/55">{t.note}</p>
                </div>
                <span className="text-xs text-ink/40">{t.store}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </AppShell>
  );
}