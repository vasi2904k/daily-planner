# Daily Scheduler

Daily Scheduler helps plan goal sessions around your availability and fixed commitments. AI can suggest what to work on; the deterministic scheduler assigns session times and keeps tasks that cannot fit unscheduled.

## Requirements

- Node.js 20 or newer
- npm
- An API key for AI-generated plans (optional for working on the project without AI)

## Setup

```sh
npm install
```

Copy `.env.example` to `.env.local` if you want to use AI features, then add your provider key to `.env.local`:

```dotenv
AI_PROVIDER=groq
GROQ_API_KEY=your-groq-api-key
GROQ_MODEL=llama-3.3-70b-versatile
```

Alternatively, select Gemini and set `GEMINI_API_KEY`. The provider and key are read by server-side API routes. Keep real keys in `.env.local`; never commit them or paste them into client-side code. `.env.local` is ignored by Git. `.env.example` is safe to commit and contains blank key values.

## Run locally

```sh
npm run dev
```

Open <http://localhost:3000>. In Windows PowerShell, use `npm.cmd` if the execution policy blocks `npm` scripts.

## Features

- Create goals and generate plans with the configured AI provider.
- Schedule goal tasks around selected days, preferred times, existing sessions, quiet hours, and commitments.
- Preserve full task durations. Tasks that cannot fit remain unscheduled and can be reviewed from the goal.
- View scheduled sessions and commitments in Today and week views.
- Track goal progress and mark sessions in progress or complete.
- Save goals, tasks, and commitments in this browser using localStorage (`daily-scheduler-v1`). Data is local to the browser and does not sync between devices.
- Start with a clearly labeled example goal and schedule.

## API routes

- `POST /api/ai/generate-plan` generates a structured goal plan.
- `POST /api/ai/analyze-goal` analyzes a goal and returns a plan.
- `POST /api/ai/interview` handles an onboarding interview step.
- `GET /api/ai/health` checks AI provider configuration and availability.
- `GET /api/schedule?date=YYYY-MM-DD&view=today|week` returns example schedule data; it does not read the browser's saved planner.

## Checks

```sh
npm test
npm run lint
npm run typecheck
npm run build
```

## Before publishing to GitHub

Review the files being staged. Do not add `.env.local`, API keys, `node_modules`, or `.next`. The repository's `.gitignore` excludes local environment files and generated dependencies/build output. Commit `.env.example` only with its key values blank.
