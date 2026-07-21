# naehrbert — frontend

Vite + React + TypeScript client for the calorie/nutrition receipt
optimizer. Talks only to the FastAPI backend (`../backend`) — never to
Supabase directly.

Scope for this scaffold (Epic 0.1) is routing + tooling only. The actual
screens are placeholders and get built out epic-by-epic; see
`../instructions/clean_rebuild_epics.md`.

## Routes

Exactly 4, matching the v1 user flow:

| Path       | Page             | Epic   |
| ---------- | ---------------- | ------ |
| `/`        | `OnboardingPage` | Epic 1 |
| `/targets` | `TargetsPage`    | Epic 2 |
| `/upload`  | `UploadPage`     | Epic 3 |
| `/results` | `ResultsPage`    | Epic 7 |

A persistent nav bar (`src/components/NavBar.tsx`) links all 4 routes,
including "Results", per Epic 7.3.

## Local development

```bash
npm install
cp .env.example .env   # then set VITE_API_BASE_URL if not localhost:8000
npm run dev            # http://localhost:5173
```

## Build

```bash
npm run build           # tsc -b && vite build -> dist/
npm run preview         # serve the production build locally
```

## Lint / format

```bash
npm run lint            # eslint .
npm run format          # prettier --write .
npm run format:check    # prettier --check .
```

## Docker (local dev)

```bash
docker build -t naehrbert-frontend .
docker run --rm -p 4173:4173 --env-file .env naehrbert-frontend
```

The image is a simple multi-stage build (`npm run build`, then
`vite preview`) intended for local docker-compose use, not a hardened
production deployment.

## API client

`src/lib/api.ts` is a thin fetch wrapper around the backend, reading its
base URL from `VITE_API_BASE_URL`. It stubs the planned REST surface
(`createProfile`, `getTargets`, `uploadReceiptFile`/`uploadReceiptText`,
`confirmReceipt`, `getComposition`, `getTargetComparison`, `getBuckets`,
`getDiversity`) with approximate TypeScript types to be refined as each
epic's real endpoint/UI is built.
