# Deployment — Render (Backend) + Vercel (Frontend)

Architektur: **Frontend (Vercel) → Backend (Render) → Supabase (extern)**.
Das Frontend spricht Supabase nie direkt an, nur das Backend.

```
Browser ──► Vercel (React/Vite SPA) ──► Render (FastAPI) ──► Supabase (Postgres)
```

Beteiligte Dateien:

- [render.yaml](render.yaml) — Render-Blueprint für das Backend (Docker)
- [frontend/vercel.json](frontend/vercel.json) — Vercel-Config fürs Frontend (SPA-Rewrites)
- [.github/workflows/keepalive.yml](.github/workflows/keepalive.yml) — Keep-Alive gegen Render-Kaltstart

---

## 1. Backend → Render

Render, weil das Backend **System-Binaries** braucht (`tesseract-ocr` für OCR,
`libglib2.0-0` für OpenCV). Ein reines Serverless-Setup (z. B. Vercel Functions)
scheidet dadurch aus — es muss Docker sein.

1. Render Dashboard → **New +** → **Blueprint** → dieses Repo auswählen.
   Render liest `render.yaml` und legt `nutriwise-backend` an.
2. Im **Environment**-Tab die Secrets setzen (im Blueprint als `sync: false`
   markiert, deshalb nicht im Repo):

   | Variable                     | Wert                                                      |
   | ---------------------------- | --------------------------------------------------------- |
   | `SUPABASE_URL`               | aus dem Supabase-Projekt                                   |
   | `SUPABASE_SERVICE_ROLE_KEY`  | aus dem Supabase-Projekt (Service-Role, **geheim**)       |
   | `ALLOWED_ORIGINS`            | Vercel-URL(s), kommagetrennt — siehe Schritt 4            |
   | `GEMINI_API_KEY`             | optional (nur für `POST /recipes/generate`)               |

3. Deploy abwarten, dann testen:
   `curl https://<service>.onrender.com/health` → `{"status":"ok"}`

**Free-Tier-Fallstricke:** 512 MB RAM (reicht knapp für OCR/OpenCV),
Service **schläft nach 15 Min Inaktivität ein** (~50 s Kaltstart beim nächsten
Request — siehe Abschnitt 3), und der Docker-Build dauert wegen der
Apt-Pakete ein paar Minuten.

---

## 2. Frontend → Vercel

1. Vercel → **Add New Project** → dieses Repo importieren.
2. **Root Directory** auf `frontend` setzen. Framework „Vite" wird erkannt;
   Build/Output kommen aus `frontend/vercel.json`.
3. Environment Variable setzen:

   | Variable            | Wert                                |
   | ------------------- | ----------------------------------- |
   | `VITE_API_BASE_URL` | `https://<service>.onrender.com`    |

   > Vite-Env-Vars werden **zur Build-Zeit** eingebacken. Nach einer Änderung
   > von `VITE_API_BASE_URL` neu deployen.
4. Nach dem ersten Deploy die Vercel-Domain (z. B. `https://nutriwise.vercel.app`)
   in Renders `ALLOWED_ORIGINS` eintragen und das Backend neu deployen —
   sonst blockt CORS. Für Preview-Deploys ggf. auch die `*-git-*.vercel.app`-URL.

Die `rewrites`-Regel in `vercel.json` leitet alle Pfade auf `index.html` —
nötig, damit Deep-Links des React-Routers (z. B. `/pantry`) nicht 404en.

---

## 3. Cron / Keep-Alive — cron-job.org, ja oder nein?

**Wichtig zuerst:** Der Code hat **keinen** geplanten Task (kein Snapshot-Job,
kein nächtlicher Import o. Ä.). „Cron" wird hier **nur** für eins gebraucht:
das Render-Free-Backend wachhalten, damit die Demo keinen 50-s-Kaltstart hat.
Für einen echten periodischen Job wäre die Bewertung eine andere.

### cron-job.org

| Pro                                            | Contra                                                                             |
| ---------------------------------------------- | ---------------------------------------------------------------------------------- |
| Kostenlos, in 2 Min eingerichtet               | Weiterer Drittanbieter, der eure URL kennt/pingt                                    |
| Intervalle bis zu 1 Min, E-Mail bei Ausfall    | Ping alle ~12 Min hält den Service quasi 24/7 wach                                  |
| Kein Account-/Infra-Aufwand                    | → verbraucht fast die kompletten **750 Render-Free-Instanzstunden/Monat** (~730 h) |
|                                                | Löst nur die Demo, nicht den Kaltstart für echte erste Nutzer:innen                 |

**Fazit:** Für einen Bootcamp-Prototyp völlig ok und schnell. Aber es ist kein
Vorteil gegenüber den Alternativen — und man sollte wissen, dass Dauer-Pingen
das Free-Stundenkontingent aufbraucht (kritisch, sobald ein zweiter Free-Service
dazukommt).

### Kostenlose Alternativen

1. **GitHub Actions (empfohlen, bereits im Repo)** —
   [.github/workflows/keepalive.yml](.github/workflows/keepalive.yml).
   Kein neuer Drittanbieter, ihr nutzt Actions ohnehin schon. Nur das Secret
   `BACKEND_HEALTH_URL` setzen. Einschränkung: der Zeitplan feuert „best effort"
   (kann sich minutenweise verspäten) und wird nach 60 Tagen Repo-Inaktivität
   deaktiviert — für ein aktives Projekt irrelevant.
2. **UptimeRobot** — kostenloser Monitor, Ping alle 5 Min, dazu ein
   Uptime-Dashboard + Alerts. Praktisch, wenn ihr Verfügbarkeit ohnehin
   überwachen wollt (Keep-Alive + Monitoring in einem).
3. **Render Cron Jobs** (nativ) — sauber, aber **kostenpflichtig** (kein
   Free-Tier). Erst relevant, falls ihr mal einen echten geplanten Job braucht.
4. **Kaltstart einfach akzeptieren** — kostet 0 Stunden, ehrlichste Option,
   wenn die App nur sporadisch genutzt wird. Der ~50-s-Start trifft nur den
   ersten Request nach der Schlafphase.

**Empfehlung:** GitHub-Actions-Keep-Alive kurz vor der Demo aktivieren (Secret
setzen), sonst im Alltag ruhen lassen und den Kaltstart akzeptieren — das schont
die Free-Instanzstunden. cron-job.org tut es genauso, bringt aber einen
überflüssigen Drittanbieter ins Spiel.
