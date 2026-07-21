import { useEffect, useRef, useState, type ReactNode } from "react";
import { Card, PrimaryButton, inputCls } from "@/components/AppShell";
import { cn } from "@/lib/utils";
import { useLanguage, type Lang } from "@/lib/i18n";
import { createProfile, updateProfile, ApiError } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import type { IdealProfile, Profile, ProfileCreate } from "@/types/api";

// Chat-style Level-1 onboarding (E1-S5). The chat itself only ever asks
// ONBOARDING_STEPS below — name, sex, date of birth, height, weight,
// exercise frequency, daily movement, goal — exactly what the Ideal
// Profile Engine (E2) needs to compute calories + macros. Every other
// preference (diet type, allergies, dislikes)
// is collected later, in Profile Settings (ProfileSummary.tsx), which
// reuses the fuller STEPS list further down so those fields stay
// editable without ever blocking onboarding.
//
// Everything the bot "says" is one continuous, strictly-ordered sequence
// of typed chat bubbles (see SequenceView) — the previous step's reply
// finishes typing before the next step's question even starts, and that
// question's input controls only appear once the question itself (and
// its hint) has finished typing. Nothing pops up ahead of its turn.

export type Bi = { en: string; de: string };
export const bi = (en: string, de: string): Bi => ({ en, de });

export type StepKind = "choice" | "multi" | "text" | "number" | "date";
export type MultiKey = "allergies" | "dislikes";

export interface Option {
  value: string;
  label: Bi;
}

export interface StepDef {
  key: string;
  // Bot messages shown BEFORE `prompt`, each typed in its own turn — e.g.
  // splitting a greeting from the actual question that follows it.
  promptIntro?: Bi[];
  prompt: Bi;
  hint?: Bi;
  shortLabel?: Bi;
  category?: Bi;
  // Reassuring reply shown after the answer (R-FEEDBACK).
  feedback?: Bi;
  // Additional bot messages shown right after `feedback`, each typed out
  // in sequence — for breaking up a longer explanation into readable
  // beats instead of one wall of text. Optional; most steps only need
  // `feedback`.
  extraFeedback?: Bi[];
  disclaimer?: Bi;
  kind: StepKind;
  options?: Option[];
  placeholder?: Bi;
  optional?: boolean;
  // Only ask this step when the predicate holds (e.g. pregnancy for
  // female profiles only). Absent = always shown.
  showIf?: (answers: Record<string, unknown>) => boolean;
}

// Shared between STEPS (Profile Settings) and ONBOARDING_STEPS (the chat)
// below, so these option lists only need to be spelled out once.
const GOAL_OPTIONS: Option[] = [
  { value: "lose_weight_gradually", label: bi("⚖️ Lose fat", "⚖️ Fett verlieren") },
  { value: "maintain", label: bi("🧭 Maintain weight", "🧭 Gewicht Halten") },
  { value: "build_muscle", label: bi("🏋️ Build muscle", "🏋️ Muskeln aufbauen") },
];
const SEX_OPTIONS: Option[] = [
  { value: "female", label: bi("Female", "Weiblich") },
  { value: "male", label: bi("Male", "Männlich") },
  { value: "prefer_not_to_say", label: bi("Prefer not to say", "Keine Angabe") },
];
const EXERCISE_OPTIONS: Option[] = [
  { value: "none", label: bi("🛋️ Rarely / never", "🛋️ Selten / nie") },
  { value: "one_two", label: bi("🚶 1–2× per week", "🚶 1–2× pro Woche") },
  { value: "three_four", label: bi("🏃 3–4× per week", "🏃 3–4× pro Woche") },
  { value: "five_six", label: bi("💪 5–6× per week", "💪 5–6× pro Woche") },
  { value: "daily_athlete", label: bi("🏅 Daily / athlete", "🏅 Täglich / Leistungssport") },
];
const MOVEMENT_OPTIONS: Option[] = [
  { value: "mostly_sitting", label: bi("🪑 Mostly sitting", "🪑 Überwiegend sitzend") },
  { value: "mixed", label: bi("🔀 A mix of sitting & moving", "🔀 Mix aus Sitzen & Bewegen") },
  { value: "mostly_standing", label: bi("🧍 Mostly on my feet", "🧍 Überwiegend auf den Beinen") },
  { value: "physical_labor", label: bi("🏗️ Physical labor", "🏗️ Körperliche Arbeit") },
];


// The chat's actual question set (onboardingflow_etc.md): name, then the
// biometrics + activity + goal the Ideal Profile Engine (E2) needs to
// compute calories and macros — nothing else. Every field here is
// mandatory (no `optional`/`showIf`) so the Ideal Profile is always
// computable once `goal` is answered. `feedback`/`extraFeedback` on
// `name` and `sex` are placeholders — their real reply sequences are
// dynamic (see replySequenceFor below) and use the NAME_*/SEX_FORMULA_*
// constants further down instead.
export const ONBOARDING_STEPS: StepDef[] = [
  {
    key: "name",
    promptIntro: [
      bi(
        "Hi, I'm Nährbert — your companion for healthy eating, smart grocery shopping, and cooking at home.",
        "Hi, ich bin Nährbert, dein Helfer rund um gesunde Ernährung, smartes Einkaufen und Kochen zu Hause.",
      ),
    ],
    prompt: bi(
      "So I can address you properly from now on: what should I call you?",
      "Damit ich dich in Zukunft richtig ansprechen kann: Wie darf ich dich nennen?",
    ),
    shortLabel: bi("Name", "Name"),
    category: bi("Personal", "Persönlich"),
    kind: "text",
    placeholder: bi("Your name", "Dein Name"),
    feedback: bi(
      "Quick heads-up: I can't replace medical advice, and I'm not a dietitian in the traditional sense.",
      "Kurzer Hinweis: Ich kann keinen ärztlichen Rat ersetzen und bin auch kein Ernährungsberater im traditionellen Sinne.",
    ),
  },
  {
    key: "sex",
    prompt: bi("What sex were you assigned at birth?", "Welches Geschlecht wurde dir bei deiner Geburt zugeordnet?"),
    shortLabel: bi("Sex at birth", "Geschlecht bei Geburt"),
    category: bi("Personalization", "Personalisierung"),
    hint: bi(
      "Sorry if that sounds a little odd — being biologically male or female meaningfully affects your energy needs. If you'd rather not say, that's fine too: I'll just use the midpoint of both.",
      "Sorry, das mag etwas komisch klingen — aber biologisch männlich oder weiblich zu sein beeinflusst deinen Verbrauch erheblich. Wenn du das nicht angeben möchtest, ist das auch okay: Dann rechne ich einfach mit der Mitte aus beidem.",
    ),
    kind: "choice",
    options: SEX_OPTIONS,
  },
  {
    key: "date_of_birth",
    prompt: bi("When were you born?", "Wann wurdest du geboren?"),
    shortLabel: bi("Date of birth", "Geburtsdatum"),
    category: bi("Personalization", "Personalisierung"),
    kind: "date",
  },
  {
    key: "height_cm",
    prompt: bi("How tall are you, in cm?", "Wie groß bist du, in cm?"),
    shortLabel: bi("Height (cm)", "Größe (cm)"),
    category: bi("Personalization", "Personalisierung"),
    placeholder: bi("e.g. 170", "z.B. 170"),
    kind: "number",
  },
  {
    key: "weight_kg",
    prompt: bi("And how much do you weigh, in kg?", "Und wie viel wiegst du, in kg?"),
    shortLabel: bi("Weight (kg)", "Gewicht (kg)"),
    category: bi("Personalization", "Personalisierung"),
    placeholder: bi("e.g. 68", "z.B. 68"),
    kind: "number",
    // No feedback text here (#1) — the async BMR reveal (bold, once the
    // backend has computed it) is the only thing shown after this answer.
  },
  {
    key: "exercise_frequency",
    prompt: bi(
      "That's not all — depending on your goal and activity, we'll now adjust your BMR into your Total Daily Energy Expenditure (TDEE). How often do you currently exercise per week?",
      "Das ist noch nicht alles: Abhängig von deinem Ziel und deiner Aktivität passen wir deinen Grundumsatz jetzt noch auf deinen Gesamtenergiebedarf (TDEE) an. Wie oft machst du aktuell Sport pro Woche?",
    ),
    shortLabel: bi("Exercise frequency", "Trainingshäufigkeit"),
    category: bi("Activity", "Aktivität"),
    hint: bi(
      "Depending on your activity level, we add up to 600 kcal per day to your needs.",
      "Je nach Aktivitätslevel fügen wir bis zu 600 kcal pro Tag zu deinem Bedarf hinzu.",
    ),
    kind: "choice",
    options: EXERCISE_OPTIONS,
  },
  {
    key: "daily_movement",
    prompt: bi("And what does your day-to-day look like?", "Und wie sieht dein Alltag aus?"),
    shortLabel: bi("Daily movement", "Alltagsbewegung"),
    category: bi("Activity", "Aktivität"),
    hint: bi(
      "Depending on your daily routine, we multiply your calorie needs by up to 1.35×.",
      "Je nach Alltagssituation multiplizieren wir deinen Kalorienbedarf um bis zu 1,35×.",
    ),
    kind: "choice",
    options: MOVEMENT_OPTIONS,
  },
  {
    key: "goal",
    prompt: bi(
      "And one last thing: which of these goals fits you best?",
      "Und jetzt noch: Welches dieser Ziele trifft am ehesten auf dich zu?",
    ),
    shortLabel: bi("Goal", "Ziel"),
    category: bi("Goal", "Ziel"),
    hint: bi(
      "Depending on your choice, we'll lower your daily target, keep it the same, or raise it.",
      "Je nach Auswahl verringern wir deinen Tagesbedarf, belassen ihn gleich oder steigern ihn.",
    ),
    kind: "choice",
    options: GOAL_OPTIONS,
  },
];

const SEND_LABEL = bi("Send", "Senden");
const CREATING_LABEL = bi(
  "All set — saving your profile, then let's upload your first receipt as a baseline…",
  "Alles klar — dein Profil wird gespeichert, danach lädst du deinen ersten Kassenbon hoch…",
);
const CREATE_PROFILE_FAILED = bi("Could not save profile.", "Profil konnte nicht gespeichert werden.");
const START_UPLOADING_LABEL = bi("Start uploading receipts", "Kassenzettel-Upload starten");
const CANCEL_LABEL = bi("Cancel", "Abbrechen");
const SAVE_LABEL = bi("Save", "Speichern");
const EDIT_LABEL = bi("Edit", "Bearbeiten");
const RANGE_ERROR = bi("Please enter a realistic value.", "Bitte einen realistischen Wert eingeben.");

type Answers = {
  name: string;
  form_of_address: string;
  goal: string;
  dietary_pattern: string;
  sex: string;
  date_of_birth: string;
  height_cm: string;
  weight_kg: string;
  exercise_frequency: string;
  daily_movement: string;
  meals_per_day: string;
  snacks_per_day: string;
  pregnancy_status: string;
  allergies: string[];
  dislikes: string[];
  symptoms: string[];
  digestion: string;
  veg_frequency: string;
};

const INITIAL_ANSWERS: Answers = {
  name: "",
  form_of_address: "neutral",
  goal: "maintain",
  dietary_pattern: "omnivore",
  sex: "",
  date_of_birth: "",
  height_cm: "",
  weight_kg: "",
  exercise_frequency: "",
  daily_movement: "",
  meals_per_day: "",
  snacks_per_day: "",
  pregnancy_status: "",
  allergies: [],
  dislikes: [],
  symptoms: [],
  digestion: "",
  veg_frequency: "",
};

// Derive the legacy fields the rest of the app still reads (BR-compatible)
// from the new Level-1 answers, so downstream code (recommender,
// nutrition_personalization) keeps working unchanged.
const _ACTIVITY_FROM_EXERCISE: Record<string, ProfileCreate["activity_level"]> = {
  none: "mostly_sitting",
  one_two: "light_activity",
  three_four: "moderately_active",
  five_six: "very_active",
  daily_athlete: "very_active",
};
const _GENDER_FROM_SEX: Record<string, ProfileCreate["gender"]> = {
  female: "female",
  male: "male",
  prefer_not_to_say: "other",
};

// Out-of-range guard (E1-S5). Only height_cm/weight_kg are ever checked
// here — the only numeric ONBOARDING_STEPS fields (meals/snacks per day
// live only in STEPS, for the Profile Settings form).
const _NUMERIC_KEYS = new Set(["height_cm", "weight_kg"]);

function rangeError(key: string, value: string): Bi | null {
  if (!value || !_NUMERIC_KEYS.has(key)) return null;
  const n = Number(value);
  if (Number.isNaN(n)) return RANGE_ERROR;
  if (key === "height_cm" && (n < 100 || n > 250)) return RANGE_ERROR;
  if (key === "weight_kg" && (n < 30 || n > 300)) return RANGE_ERROR;
  return null;
}

// ── Dynamic / structured bot content (#3, #5, #6, #7) ────────────────────

// The chat's opening explanation, split into short beats (#1) instead of
// one long paragraph — shown after `name` is answered.
const NAME_PROFILES_INTRO = bi(
  "But I'll help you eat in a more balanced way so you stay healthy and reach your goals — by working out 2 Ideal Profiles for you:",
  "Trotzdem helfe ich dir dabei, dich ausgewogener zu ernähren, damit du gesund bleibst und deine Ziele erreichst — dafür berechne ich 2 Idealprofile:",
);
const NAME_PROFILE_BULLETS: Record<Lang, string[]> = {
  en: [
    "🔥 Calories — your energy balance and body weight",
    "💪 Macros — to fuel performance, muscle, and metabolism",
  ],
  de: [
    "🔥 Kalorien — deine Energiebalance und dein Körpergewicht",
    "💪 Makros — für Leistung, Muskeln und Stoffwechsel",
  ],
};
const NAME_BMR_INTRO = bi(
  "To do that, I need a bit of information about you. Let's start with the baseline: your Basal Metabolic Rate (BMR).",
  "Dafür brauche ich ein paar Informationen über dich. Fangen wir mit der Baseline an: deinem Grundumsatz / Basal Metabolic Rate (BMR).",
);

// The BMR formula preview (#3): shown BEFORE date_of_birth/height/weight
// are asked, so the user knows upfront which 3 answers feed the BMR and
// why. Gender-specific (#6): only the formula for the sex actually
// chosen is shown, not both variants at once.
const SEX_FORMULA_INTRO = bi(
  "Thanks. Here's the actual formula:",
  "Danke. Hier ist die Formel dazu:",
);
const SEX_FORMULA_NEXT = bi(
  "So next up, I'll need your date of birth, your height, and your weight.",
  "Als Nächstes brauche ich also dein Geburtsdatum, deine Größe und dein Gewicht.",
);

function sexFormulaLine(sex: string, lang: Lang): string {
  if (sex === "male") {
    return lang === "de"
      ? "BMR = 10 × Gewicht (kg) + 6,25 × Größe (cm) − 5 × Alter (Jahre) + 5."
      : "BMR = 10 × weight (kg) + 6.25 × height (cm) − 5 × age (years) + 5.";
  }
  if (sex === "female") {
    return lang === "de"
      ? "BMR = 10 × Gewicht (kg) + 6,25 × Größe (cm) − 5 × Alter (Jahre) − 161."
      : "BMR = 10 × weight (kg) + 6.25 × height (cm) − 5 × age (years) − 161.";
  }
  // prefer_not_to_say (or unanswered) — the same male/female midpoint the
  // backend actually uses (BR-E1, services/ideal_profile.py's _bmr()).
  return lang === "de"
    ? "BMR = 10 × Gewicht (kg) + 6,25 × Größe (cm) − 5 × Alter (Jahre) − 78 (der Mittelwert aus beidem, da du nichts angegeben hast)."
    : "BMR = 10 × weight (kg) + 6.25 × height (cm) − 5 × age (years) − 78 (the midpoint between both, since you didn't specify).";
}

// Dynamic reveal shown right after `weight_kg` is answered — by then
// sex/date_of_birth/height/weight are all known, so the BMR the backend
// just computed (Mifflin-St Jeor, BR-E1) is already real, not a preview.
// Bold (#4), like every other calculated result in this chat.
function bmrResultNode(ideal: IdealProfile, lang: Lang): ReactNode {
  return lang === "de" ? (
    <>
      Dein BMR ist: <strong>{ideal.bmr_kcal} kcal</strong>.
    </>
  ) : (
    <>
      Your BMR is: <strong>{ideal.bmr_kcal} kcal</strong>.
    </>
  );
}

// Structured (non-typed) results shown after `goal` is answered (#7): the
// calculated numbers are bold and the macro split is a real bullet list,
// not prose — these render instantly (see SequenceView's "node" handling)
// rather than typing letter by letter.
function bulletList(items: string[]): ReactNode {
  return (
    <ul className="list-disc space-y-1 pl-4">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

function calorieResultNode(ideal: IdealProfile, lang: Lang): ReactNode {
  return lang === "de" ? (
    <>
      Dein durchschnittlicher idealer Kalorienverbrauch pro Tag liegt bei etwa{" "}
      <strong>{ideal.calories_kcal} kcal</strong>.
    </>
  ) : (
    <>
      Your average ideal calorie intake per day is about <strong>{ideal.calories_kcal} kcal</strong>.
    </>
  );
}

function macroListNode(ideal: IdealProfile, lang: Lang): ReactNode {
  return (
    <>
      <p className="mb-1">
        {lang === "de"
          ? "Außerdem sollten deine Makronährwerte idealerweise so verteilt sein:"
          : "Your macros should ideally be split like this:"}
      </p>
      <ul className="list-disc space-y-0.5 pl-4">
        <li>
          <strong>{ideal.carbs_g}g</strong> {lang === "de" ? "Kohlenhydrate" : "carbs"}
        </li>
        <li>
          <strong>{ideal.protein_g}g</strong> {lang === "de" ? "Proteine" : "protein"}
        </li>
        <li>
          <strong>{ideal.fat_g}g</strong> {lang === "de" ? "Fette" : "fat"}
        </li>
      </ul>
    </>
  );
}

const EDIT_LATER_NOTE = bi(
  "If anything about you changes, you can always adjust these later via your profile icon, top right.",
  "Sollte sich an deinen Angaben etwas ändern, kannst du diese jederzeit über dein Profil-Icon oben rechts anpassen.",
);
const UNLOCK_NEXT_LEVEL_TEXT = bi(
  "Great — that's everything I need to get started. To unlock the next level of the app, upload as many receipts as you can now — ideally as a digital receipt from a supermarket loyalty app, or clean, upright photos. Once you've uploaded 50 food items, you're through.",
  "Super, dann habe ich für den Start erstmal alles von dir, was ich brauche. Um das nächste Level der App freizuschalten, lade jetzt bitte so viele Kassenzettel wie möglich hoch — im Idealfall als digitalen Bon aus einer Supermarkt-Loyalitäts-App oder als saubere, gerade Fotos. Sobald du auf 50 hochgeladene Lebensmittel kommst, geht's weiter.",
);

// ── Typing engine (#2, #4) ────────────────────────────────────────────────

// Speed of the letter-by-letter typing effect, in ms per character —
// ~25% slower than an earlier 14ms/char. Tune here.
const TYPEWRITER_MS_PER_CHAR = 19;

// How long a purely-visual ("node") message pauses for before the
// sequence advances — it doesn't type letter-by-letter (bullet lists /
// bold results render as real markup), so this stands in for "reading
// time" instead.
const NODE_PAUSE_MS = 900;

// One message in the conversation's linear queue: either plain text that
// types out letter by letter, or a structured React node (bullet list,
// bold result) that appears instantly and then pauses for NODE_PAUSE_MS.
type SeqItem = { kind: "typed"; text: string } | { kind: "node"; node: ReactNode };
const typedItem = (text: string): SeqItem => ({ kind: "typed", text });
const nodeItem = (n: ReactNode): SeqItem => ({ kind: "node", node: n });

// Reveals `text` one character at a time, like it's being typed live.
// Runs once per mount and never re-types on a later re-render, since the
// effect only restarts when `text` itself changes — once a bubble has
// finished typing it just stays fully shown. Click/tap the text to skip
// straight to the end (and still fire `onDone`, so a sequence doesn't
// get stuck waiting).
export function TypewriterText({ text, onDone }: { text: string; onDone?: () => void }) {
  const [shown, setShown] = useState(0);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const doneRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setShown(0);
    doneRef.current = false;
    if (!text) {
      doneRef.current = true;
      onDoneRef.current?.();
      return;
    }
    let i = 0;
    intervalRef.current = setInterval(() => {
      i += 1;
      setShown(i);
      if (i >= text.length) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        doneRef.current = true;
        onDoneRef.current?.();
      }
    }, TYPEWRITER_MS_PER_CHAR);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [text]);

  function skip() {
    if (doneRef.current) return;
    if (intervalRef.current) clearInterval(intervalRef.current);
    setShown(text.length);
    doneRef.current = true;
    onDoneRef.current?.();
  }

  return (
    <span onClick={skip} className="cursor-default">
      {text.slice(0, shown)}
    </span>
  );
}

// A fully-resolved sequence (history that's already been fully typed) —
// every item just appears, no animation.
function renderStaticSequence(items: SeqItem[]): ReactNode {
  return (
    <>
      {items.map((item, i) => (
        <ChatBubble key={i} from="bot">
          {item.kind === "node" ? item.node : item.text}
        </ChatBubble>
      ))}
    </>
  );
}

// Renders a slice of the CURRENT turn's queue, live (#3): everything
// before `turnRevealed` is already fully shown; the item exactly at
// `turnRevealed` is actively typing (or, for a "node" message, paused on
// for a beat) and calls `onAdvance` once it's done; anything after that
// hasn't arrived yet and isn't rendered — so a question's input controls
// can never appear before every message leading up to it has finished.
function SequenceView({
  items,
  globalOffset,
  turnRevealed,
  onAdvance,
}: {
  items: SeqItem[];
  globalOffset: number;
  turnRevealed: number;
  onAdvance: () => void;
}) {
  const liveLocalIndex = turnRevealed - globalOffset;
  const liveItem = liveLocalIndex >= 0 && liveLocalIndex < items.length ? items[liveLocalIndex] : undefined;

  useEffect(() => {
    if (liveItem?.kind !== "node") return;
    const t = setTimeout(onAdvance, NODE_PAUSE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalOffset, turnRevealed]);

  return (
    <>
      {items.map((item, localI) => {
        const globalI = globalOffset + localI;
        if (globalI > turnRevealed) return null;
        const isLive = globalI === turnRevealed;
        return (
          <ChatBubble key={globalI} from="bot">
            {item.kind === "node" ? (
              item.node
            ) : isLive ? (
              <TypewriterText text={item.text} onDone={onAdvance} />
            ) : (
              item.text
            )}
          </ChatBubble>
        );
      })}
    </>
  );
}

// ── Per-step sequence builders ────────────────────────────────────────────

function askSequenceFor(step: StepDef, lang: Lang): SeqItem[] {
  const items: SeqItem[] = [];
  if (step.promptIntro) items.push(...step.promptIntro.map((m) => typedItem(m[lang])));
  items.push(typedItem(step.prompt[lang]));
  if (step.hint) items.push(typedItem(step.hint[lang]));
  return items;
}

function replySequenceFor(step: StepDef, ans: Answers, lang: Lang): SeqItem[] {
  if (step.key === "name") {
    return [
      typedItem(step.feedback![lang]),
      typedItem(NAME_PROFILES_INTRO[lang]),
      nodeItem(bulletList(NAME_PROFILE_BULLETS[lang])),
      typedItem(NAME_BMR_INTRO[lang]),
    ];
  }
  if (step.key === "sex") {
    return [
      typedItem(SEX_FORMULA_INTRO[lang]),
      typedItem(sexFormulaLine(ans.sex, lang)),
      typedItem(SEX_FORMULA_NEXT[lang]),
    ];
  }
  const msgs: SeqItem[] = [];
  if (step.feedback) msgs.push(typedItem(step.feedback[lang]));
  if (step.extraFeedback) msgs.push(...step.extraFeedback.map((m) => typedItem(m[lang])));
  return msgs;
}

// The final reveal (#7, #9): shown once `goal` is answered and the Ideal
// Profile Engine (E2) has computed real calories/macros.
function revealSequence(ideal: IdealProfile | null, lang: Lang): SeqItem[] {
  if (!ideal) return [typedItem(UNLOCK_NEXT_LEVEL_TEXT[lang])];
  return [
    nodeItem(calorieResultNode(ideal, lang)),
    nodeItem(macroListNode(ideal, lang)),
    typedItem(EDIT_LATER_NOTE[lang]),
    typedItem(UNLOCK_NEXT_LEVEL_TEXT[lang]),
  ];
}

function BotAvatar() {
  return (
    <span
      aria-hidden
      className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-sm ring-2 ring-white"
    >
      🌱
    </span>
  );
}

function ChatBubble({ from, children }: { from: "bot" | "user"; children: React.ReactNode }) {
  return (
    <div className={cn("flex items-end gap-2", from === "user" ? "justify-end" : "justify-start")}>
      {from === "bot" ? <BotAvatar /> : null}
      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm",
          from === "user" ? "bg-ink text-canvas" : "bg-zinc-100 text-ink",
        )}
      >
        {children}
      </div>
    </div>
  );
}

function InlineAnswerEditor({
  step,
  value,
  lang,
  onSave,
  onCancel,
}: {
  step: StepDef;
  value: unknown;
  lang: Lang;
  onSave: (value: string | string[]) => void;
  onCancel: () => void;
}) {
  const [multiDraft, setMultiDraft] = useState<string[]>(
    step.kind === "multi" ? [...((value as string[]) ?? [])] : [],
  );
  const [textDraft, setTextDraft] = useState<string>(
    step.kind === "multi" ? "" : String(value ?? ""),
  );

  if (step.kind === "choice") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {step.options!.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onSave(opt.value)}
            className={cn(
              "rounded-xl px-3 py-2 text-xs font-medium tracking-tight ring-1 transition-colors",
              opt.value === value
                ? "bg-ink text-canvas ring-ink"
                : "bg-zinc-50 text-ink/60 ring-black/5 hover:text-ink",
            )}
          >
            {opt.label[lang]}
          </button>
        ))}
        <button type="button" onClick={onCancel} className="text-xs text-ink/40 hover:text-ink">
          {CANCEL_LABEL[lang]}
        </button>
      </div>
    );
  }

  if (step.kind === "multi") {
    function toggle(v: string) {
      setMultiDraft((prev) => {
        if (v === "none") return prev.includes("none") ? [] : ["none"];
        if (prev.includes(v)) return prev.filter((x) => x !== v);
        return [...prev.filter((x) => x !== "none"), v];
      });
    }
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          {step.options!.map((opt) => {
            const selected = multiDraft.includes(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => toggle(opt.value)}
                className={cn(
                  "rounded-xl px-3 py-2 text-xs font-medium tracking-tight ring-1 transition-colors",
                  selected ? "bg-ink text-canvas ring-ink" : "bg-zinc-50 text-ink/60 ring-black/5 hover:text-ink",
                )}
              >
                {opt.label[lang]}
              </button>
            );
          })}
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => onSave(multiDraft)}
            className="rounded-full bg-ink px-3 py-1.5 text-xs font-medium tracking-tight text-canvas"
          >
            {SAVE_LABEL[lang]}
          </button>
          <button type="button" onClick={onCancel} className="text-xs text-ink/40 hover:text-ink">
            {CANCEL_LABEL[lang]}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <input
        className={inputCls}
        type={step.kind === "number" ? "number" : step.kind === "date" ? "date" : "text"}
        value={textDraft}
        onChange={(e) => setTextDraft(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onSave(textDraft.trim())}
        autoFocus
      />
      <button
        type="button"
        onClick={() => onSave(textDraft.trim())}
        className="shrink-0 rounded-xl bg-ink px-4 py-2.5 text-xs font-medium tracking-tight text-canvas"
      >
        {SAVE_LABEL[lang]}
      </button>
      <button type="button" onClick={onCancel} className="shrink-0 text-xs text-ink/40 hover:text-ink">
        {CANCEL_LABEL[lang]}
      </button>
    </div>
  );
}

export function answerLabel(step: StepDef, answers: Record<string, unknown>, lang: Lang): string {
  const value = answers[step.key];
  if (step.kind === "choice") {
    return step.options?.find((o) => o.value === value)?.label[lang] ?? String(value ?? "—");
  }
  if (step.kind === "multi") {
    const list = (value as string[]) ?? [];
    if (list.length === 0) return "—";
    return list.map((v) => step.options?.find((o) => o.value === v)?.label[lang] ?? v).join(", ");
  }
  return (value as string) || "—";
}

function findFirstUnanswered(steps: StepDef[], ans: Answers): number {
  const idx = steps.findIndex((s) => {
    const v = ans[s.key as keyof Answers];
    if (Array.isArray(v)) return false; // multis are never "blocking"
    return !v && !s.optional;
  });
  return idx === -1 ? 0 : idx;
}

export function ChatOnboardingStep({
  resumeProfile,
  resumeProfileId,
  onProfileCreated,
}: {
  resumeProfile?: Profile | null;
  resumeProfileId?: string | null;
  onProfileCreated: (profileId: string, name: string | null) => void;
}) {
  const { language } = useLanguage();
  const lang: Lang = language;

  const initialAnswers = resumeProfile ? profileToAnswers(resumeProfile) : INITIAL_ANSWERS;
  const [answers, setAnswers] = useState<Answers>(initialAnswers);
  const [draftText, setDraftText] = useState("");
  // "chat": answering questions. "saving": final submit in flight.
  // "reveal": submit succeeded — showing the computed calories/macros and
  // the hand-off to the baseline receipt upload.
  const [phase, setPhase] = useState<"chat" | "saving" | "reveal">("chat");
  const [error, setError] = useState<string | null>(null);
  const [inputError, setInputError] = useState<Bi | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  // The Ideal Profile Engine's (E2) output as of the last save — populated
  // as soon as sex/date_of_birth/height/weight are all known (even before
  // exercise/movement/goal are answered, since those default sensibly),
  // so the BMR reveal right after `weight_kg` is already the real number.
  const [latestIdeal, setLatestIdeal] = useState<IdealProfile | null>(
    resumeProfile?.ideal_profile ?? null,
  );
  const [revealName, setRevealName] = useState<string | null>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const savedIdRef = useRef<string | null>(resumeProfileId ?? null);

  // The chat's fixed 8-question set (onboardingflow_etc.md) — none are
  // conditional, but `showIf` stays supported for parity with STEPS.
  const visibleSteps = ONBOARDING_STEPS.filter((s) => !s.showIf || s.showIf(answers));

  const [stepIndex, setStepIndex] = useState<number>(() =>
    resumeProfile ? findFirstUnanswered(visibleSteps, initialAnswers) : 0,
  );

  // The live "turn": everything typing right now, in strict order — the
  // just-answered step's reply (if any) followed by the newly-current
  // step's ask sequence (question + hint). `turnReplyCount` marks where
  // the reply ends and the ask begins, so the history area and the
  // current-question area can each render their half while both stay
  // driven by the same shared counter — nothing "pops up" ahead of its
  // turn (#3). Reused as-is for the reveal phase's own sequence too.
  const [turnQueue, setTurnQueue] = useState<SeqItem[]>(() =>
    askSequenceFor(visibleSteps[Math.min(stepIndex, visibleSteps.length - 1)], lang),
  );
  const [turnReplyCount, setTurnReplyCount] = useState(0);
  const [turnRevealed, setTurnRevealed] = useState(0);

  const busy = phase !== "chat";
  const done = phase !== "chat";
  const current = visibleSteps[Math.min(stepIndex, visibleSteps.length - 1)];
  const askDone = turnRevealed >= turnQueue.length;

  function advanceTurn() {
    setTurnRevealed((r) => r + 1);
  }

  // Prefill DOB from the age-gate value captured at sign-up (reconciles
  // E1-S3): the onboarding DOB is authoritative, but we don't ask twice.
  useEffect(() => {
    let cancelled = false;
    if (answers.date_of_birth) return;
    supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return;
      const dob = (data.user?.user_metadata as { date_of_birth?: string } | undefined)?.date_of_birth;
      if (dob) setAnswers((prev) => (prev.date_of_birth ? prev : { ...prev, date_of_birth: dob }));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    chatRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (historyRef.current) historyRef.current.scrollTop = historyRef.current.scrollHeight;
  }, [stepIndex, done, turnRevealed]);

  // Best-effort incremental persistence so progress survives a reload /
  // relogin (E1-S6). Failures are swallowed here — the authoritative save
  // is the final submit(). Also captures the freshly-computed Ideal
  // Profile (E2) as soon as the backend can produce one (sex/dob/height/
  // weight all set) — see the BMR reveal after `weight_kg` below.
  async function persistProgress(next: Answers) {
    try {
      const payload = { ...toProfileCreate(next, language), profile_complete: false };
      const saved = savedIdRef.current
        ? await updateProfile(savedIdRef.current, payload)
        : await createProfile(payload as ProfileCreate);
      savedIdRef.current = saved.profile_id;
      setLatestIdeal(saved.ideal_profile ?? null);
    } catch {
      // ignore — retried implicitly on the next answer, and on submit
    }
  }

  function saveEdit(key: string, value: string | string[]) {
    setAnswers((prev) => ({ ...prev, [key]: value }));
    setEditingKey(null);
  }

  async function submit(finalAnswers: Answers) {
    setPhase("saving");
    setError(null);
    try {
      const payload = { ...toProfileCreate(finalAnswers, language), profile_complete: true };
      const p = savedIdRef.current
        ? await updateProfile(savedIdRef.current, payload)
        : await createProfile(payload as ProfileCreate);
      savedIdRef.current = p.profile_id;
      setLatestIdeal(p.ideal_profile ?? null);
      setRevealName(p.name ?? finalAnswers.name ?? null);
      setTurnQueue(revealSequence(p.ideal_profile ?? null, language));
      setTurnReplyCount(0);
      setTurnRevealed(0);
      setPhase("reveal");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : CREATE_PROFILE_FAILED[language]);
      setPhase("chat");
    }
  }

  function handleContinueToUpload() {
    if (savedIdRef.current) onProfileCreated(savedIdRef.current, revealName);
  }

  // Rebuilds the live turn for the step after the one just answered.
  // Deliberately does NOT touch `stepIndex` on the final step (see
  // goNext) — `current` must stay `goal` if submit() fails, so a retry
  // re-shows the right question without duplicating it in history.
  function advance(next: Answers) {
    setDraftText("");
    setInputError(null);
    setEditingKey(null);
    void persistProgress(next);

    const nextVisible = ONBOARDING_STEPS.filter((s) => !s.showIf || s.showIf(next));
    const nextStep = nextVisible[stepIndex + 1];
    const reply = replySequenceFor(current, next, language);
    const ask = askSequenceFor(nextStep, language);
    setTurnQueue([...reply, ...ask]);
    setTurnReplyCount(reply.length);
    setTurnRevealed(0);
    setStepIndex((i) => i + 1);
  }

  function goNext(nextAnswers: Answers) {
    const nextVisible = ONBOARDING_STEPS.filter((s) => !s.showIf || s.showIf(nextAnswers));
    if (stepIndex >= nextVisible.length - 1) {
      submit(nextAnswers);
    } else {
      advance(nextAnswers);
    }
  }

  function handleChoice(value: string) {
    const next = { ...answers, [current.key]: value };
    setAnswers(next);
    goNext(next);
  }

  function handleTextSubmit() {
    const trimmed = draftText.trim();
    if (!trimmed) return;
    const err = rangeError(current.key, trimmed);
    if (err) {
      setInputError(err);
      return;
    }
    const next = { ...answers, [current.key]: trimmed };
    setAnswers(next);
    goNext(next);
  }

  // Once saving/revealed, `goal` (the last step) is answered too even
  // though `stepIndex` itself never advanced past it (see goNext above) —
  // show the full history rather than dropping the final Q&A.
  const answeredSteps = phase === "chat" ? visibleSteps.slice(0, stepIndex) : visibleSteps;

  return (
    <section className="flex flex-col px-6 pb-10">
      {/* Bug fix: this used to be an unconstrained box that visually grew
          taller with every answer (history had its own small max-height,
          but the card around it didn't) — it looked like a small box on
          the first question, then a second box appearing underneath and
          "merging in" on every answer after. Now the card is one fixed-
          height box from the very first render; history and the live
          question share a single scrollable feed inside it, and the
          input controls stay pinned to the bottom. */}
      <div ref={chatRef} className="flex h-[75vh] min-h-[480px] flex-col scroll-mt-6">
        <Card className="flex h-full flex-col overflow-hidden">
          <div ref={historyRef} className="flex-1 space-y-3 overflow-y-auto pr-1">
            {answeredSteps.map((step, stepPos) => {
              const isLastAnswered = stepPos === answeredSteps.length - 1;
              const liveReply = phase === "chat" && isLastAnswered;
              const replyItems = liveReply
                ? turnQueue.slice(0, turnReplyCount)
                : replySequenceFor(step, answers, language);
              return (
                <div key={step.key} className="space-y-1">
                  {renderStaticSequence(askSequenceFor(step, language))}
                  {editingKey === step.key ? (
                    <div className="pl-9">
                      <InlineAnswerEditor
                        step={step}
                        value={answers[step.key as keyof Answers]}
                        lang={language}
                        onSave={(value) => saveEdit(step.key, value)}
                        onCancel={() => setEditingKey(null)}
                      />
                    </div>
                  ) : (
                    <>
                      <ChatBubble from="user">{answerLabel(step, answers, language)}</ChatBubble>
                      {/* Edit sits right under the specific answer it
                          edits, not after the bot's reply below — so it's
                          unambiguous which bubble it applies to. */}
                      {!done ? (
                        <div className="flex justify-end">
                          <button
                            type="button"
                            onClick={() => setEditingKey(step.key)}
                            className="text-[11px] font-medium text-ink/35 hover:text-ink"
                          >
                            {EDIT_LABEL[lang]}
                          </button>
                        </div>
                      ) : null}
                      {/* Per-answer reassuring feedback (R-FEEDBACK). */}
                      {liveReply ? (
                        <SequenceView
                          items={replyItems}
                          globalOffset={0}
                          turnRevealed={turnRevealed}
                          onAdvance={advanceTurn}
                        />
                      ) : (
                        renderStaticSequence(replyItems)
                      )}
                      {/* Dynamic BMR reveal (bold, not typed — it's a
                          calculated result, same treatment as the final
                          calorie/macro reveal) — pops in once the backend
                          has computed it, independently of the reply
                          sequence above since it arrives async and must
                          never block the next question. */}
                      {step.key === "weight_kg" && latestIdeal ? (
                        <ChatBubble from="bot">{bmrResultNode(latestIdeal, language)}</ChatBubble>
                      ) : null}
                    </>
                  )}
                </div>
              );
            })}

            <div className={cn("space-y-1", answeredSteps.length > 0 && "border-t border-black/5 pt-4")}>
              {phase === "chat" ? (
                <SequenceView
                  items={turnQueue.slice(turnReplyCount)}
                  globalOffset={turnReplyCount}
                  turnRevealed={turnRevealed}
                  onAdvance={advanceTurn}
                />
              ) : phase === "saving" ? (
                <ChatBubble from="bot">
                  <TypewriterText text={CREATING_LABEL[lang]} />
                </ChatBubble>
              ) : (
                <SequenceView items={turnQueue} globalOffset={0} turnRevealed={turnRevealed} onAdvance={advanceTurn} />
              )}
            </div>
          </div>

          {phase === "reveal" && askDone ? (
            <div className="shrink-0 border-t border-black/5 p-4">
              <PrimaryButton type="button" onClick={handleContinueToUpload}>
                {START_UPLOADING_LABEL[lang]}
              </PrimaryButton>
            </div>
          ) : null}

          {phase === "chat" && askDone ? (
            <div className="shrink-0 space-y-3 border-t border-black/5 p-4">
              {current.kind === "choice" ? (
                <div className="flex flex-wrap gap-2">
                  {current.options!.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={busy}
                      onClick={() => handleChoice(opt.value)}
                      className="rounded-xl bg-zinc-50 px-4 py-2.5 text-sm font-medium tracking-tight text-ink/70 ring-1 ring-black/5 transition-colors hover:bg-ink hover:text-canvas disabled:opacity-40"
                    >
                      {opt.label[lang]}
                    </button>
                  ))}
                </div>
              ) : null}

              {current.kind === "text" || current.kind === "number" || current.kind === "date" ? (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      className={inputCls}
                      type={current.kind === "number" ? "number" : current.kind === "date" ? "date" : "text"}
                      placeholder={current.placeholder?.[lang]}
                      value={draftText}
                      onChange={(e) => {
                        setDraftText(e.target.value);
                        setInputError(null);
                      }}
                      onKeyDown={(e) => e.key === "Enter" && handleTextSubmit()}
                      autoFocus
                    />
                    <button
                      type="button"
                      disabled={busy}
                      onClick={handleTextSubmit}
                      className="shrink-0 rounded-xl bg-ink px-5 py-3 text-sm font-medium tracking-tight text-canvas disabled:opacity-40"
                    >
                      {SEND_LABEL[lang]}
                    </button>
                  </div>
                  {inputError ? <p className="text-xs text-red-600">{inputError[lang]}</p> : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </Card>
      </div>

      {error ? (
        <div className="mt-5 rounded-2xl bg-red-50 px-5 py-4 text-sm text-red-700 ring-1 ring-red-200">{error}</div>
      ) : null}
    </section>
  );
}
