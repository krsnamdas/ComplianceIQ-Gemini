# ComplianceIQ — Gemini Edition

A **zero-AWS** edition of **ComplianceIQ** (a MENAT Governance, Risk & Compliance intelligence
platform). It uses **Google Gemini** for AI *and* **Google Search grounding** for live web
search — so it needs **no AWS account, no Bedrock, and no Tavily**. Run it on your laptop or
any cloud host (Vercel, Netlify, Render, Railway, Cloud Run, Fly.io, …) with a **single API key**.

> Ideal for **demos outside the AWS network**. One env var (`GEMINI_API_KEY`) and you're live.
>
> - **Application features & usage:** [`APPLICATION_MANUAL.md`](./APPLICATION_MANUAL.md)
> - **AWS/Bedrock edition** (for deploying into AWS) is a separate repo.

---

## What you need

1. **Node.js 18+**
2. **A Google Gemini API key** — free from [Google AI Studio](https://aistudio.google.com)
   (Get API key). This one key powers both AI responses and web search.

That's it. No cloud account, no infrastructure.

---

## Run it locally

```bash
cp .env.example .env          # then put your GEMINI_API_KEY in .env
npm install
npm run dev                   # http://localhost:3000
```

Then open http://localhost:3000 and log in with the app accounts (see
[`APPLICATION_MANUAL.md`](./APPLICATION_MANUAL.md) §4).

---

## Deploy for a public demo (no AWS)

Any Node-friendly host works. The build command is `npm run build`; the start command is
`npm run start` (serves the built SPA + API on `$PORT`). Set **`GEMINI_API_KEY`** (and
optionally `GEMINI_MODEL_ID`) as an environment variable in the platform's dashboard.

- **Render / Railway / Fly.io / Cloud Run:** point at this repo, set the env var, deploy.
  You get a public **HTTPS URL with a trusted certificate** automatically.
- **Vercel / Netlify:** supported via their Node runtime; set the env var in project settings.
  Both also offer **password-protected deployments** if you want to gate the demo URL.

> **Auth note:** this edition has only the **app's own login** (`ciadmin` / `sasuser*`, no MFA).
> For a public demo URL, consider your host's **password protection** feature as a simple gate,
> or keep the URL private. (The AWS edition adds Cognito+MFA; this one deliberately stays simple.)

---

## How it differs from the AWS/Bedrock edition

| Area | AWS edition | **Gemini edition (this repo)** |
|---|---|---|
| AI model | Amazon Bedrock (Nova Pro) | **Google Gemini** (`gemini-2.0-flash` default) |
| Web search | Tavily API | **Google Search grounding** (built into Gemini) |
| Cloud account | Requires AWS | **None** |
| Infrastructure | VPC, ALB, ECS, Cognito, EFS, … | **None** — just a Node process |
| Secrets needed | AWS access + Tavily key | **One** `GEMINI_API_KEY` |
| HTTPS / cert | Self-signed or ACM | **Free trusted cert** from the host |
| Auth | Cognito + MFA + app login | **App login only** (add host password protection for demos) |

**The application features are identical** — same screens, data, admin console, and endpoints.
Only the AI backend differs. In code, the swap is isolated to two helpers in `server.ts`
(`invokeClaudeOnBedrock` and `tavilySearch`), whose names/signatures were kept so nothing else
changed.

---

## Configuration

| Env var | Required | Default | Purpose |
|---|---|---|---|
| `GEMINI_API_KEY` | **yes** | — | Gemini AI + search grounding |
| `GEMINI_MODEL_ID` | no | `gemini-2.0-flash` | Which Gemini model |
| `PORT` | no | `3000` | HTTP port |
| `DATA_DIR` | no | `./data/regions` | Region data location |

> If `GEMINI_API_KEY` is unset, AI features gracefully fall back to the app's deterministic/
> offline engines (the app still runs; AI/news are degraded).

---

*ComplianceIQ covers 24 MENAT jurisdictions mapped to NIST CSF 2.0, ISO/IEC 27001:2022, and
CSA CCM v4.0.10. See [`APPLICATION_MANUAL.md`](./APPLICATION_MANUAL.md) for the full feature set.*
