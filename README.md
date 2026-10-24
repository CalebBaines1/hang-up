# Hang Up

**A scam call trainer.** Hang Up rings you with a realistic AI scam call (a fake bank, a grandchild in trouble, a tax warrant), lets you handle it live by voice, and then a coach tells you in thirty seconds the tell you missed and the earliest moment you could have hung up.

It is a mobile-first, installable web app (PWA). Calls happen inside the app only: Hang Up never places a real phone call and has no phone number field.

> Built for the Nebius x NVIDIA Global AI Hackathon. The live model calls run on **NVIDIA Nemotron via Nebius Token Factory**, and speech runs on **NVIDIA Parakeet**.

## How NVIDIA Nemotron and Nebius are used

| Job | Model | Where it runs |
| --- | --- | --- |
| Plays the scammer, live, one streamed reply per turn | **NVIDIA Nemotron 3 Super** (`nvidia/nemotron-3-super-120b-a12b`), thinking off | **Nebius Token Factory** (OpenAI-compatible API) |
| Scores the call and writes the coach's debrief | **NVIDIA Nemotron 3 Super**, reasoning on | **Nebius Token Factory** |
| Hears the user (speech-to-text) | **NVIDIA Parakeet TDT 0.6B v2** (int8, via sherpa-onnx) | Speech service, built for a Nebius AI Cloud GPU VM (runs on CPU too) |
| Caller and coach voices (text-to-speech) | Kokoro 82M (Apache-2.0), 11 voices | Same speech service |

Every call makes Token Factory requests at runtime: one streamed Nemotron completion per caller turn, and one Nemotron reasoning call to score and debrief the transcript. The code is in [`apps/server/src/llm.ts`](apps/server/src/llm.ts), [`session.ts`](apps/server/src/session.ts) and [`scoring.ts`](apps/server/src/scoring.ts).

**Why Nemotron for the scammer.** A trainer is useless if the "scammer" folds politely at the first "no". Before building, we ran the bank-fraud persona on Nemotron 3 Nano, Nemotron 3 Super and Nemotron 3.5 Lightning and told it "no" three times. Nemotron 3 Super stayed in character and escalated every time ("if you hang up now the transfer will finish before you can reach anyone"), and with thinking disabled it streams its first token in about 0.6 s, which is what makes a voice call feel live. Nemotron 3 Super with reasoning on then grades the call.

## What a call looks like

1. **Opt in.** Pick a window (say weekday evenings), 1 to 3 calls a week, and a safe word.
2. **The ring.** A full-screen incoming call with a generic caller ID ("Your Bank", "Unknown"), a ringtone and vibration. It arrives at a random moment inside your window, or right away with "Ring me now".
3. **The call.** You talk; Parakeet transcribes each utterance; Nemotron answers in character; Kokoro speaks it through a phone-line filter over call-centre or street ambience. You can talk over the caller (barge-in).
4. **The ending.** You hang up, say your safe word, hand over the "payload" (a code, a card number, agreeing to pay), or the caller gives up after enough firm refusals. Calls are capped at 4 minutes.
5. **The debrief.** A score out of 100 built from behaviours that actually protect people, a spoken 30-second coach debrief, the biggest tell, what you did well, the one thing to do differently, and the transcript with each red flag marked and a "you could have hung up here" line.

### Scoring

Nemotron tags the behaviours; deterministic rules on top (time on the line, time from the first red flag to the end of the call) keep scores consistent.

| Signal | Points |
| --- | --- |
| Ended the call within 60 s of the first red flag | +40 |
| Said they'd call back on the official number | +30 |
| Asked a verifying question the caller couldn't answer | +15 |
| Refused the code, card or payment | +15 |
| Stayed on the line past 3 minutes | −10 |
| Gave partial personal info | −20 |
| Gave the payload | −50 |

### Scenarios

Ten scams, each with three difficulty levels (clumsy, competent, expert): bank fraud alert, grandparent emergency, tech support, crypto opportunity, boss needs gift cards, tax debt warrant, package held, utility shutoff, jury duty warrant, romance follow-up. Difficulty rises automatically as your scores improve. Scenario prompts live on the server in [`scenarios.ts`](apps/server/src/scenarios.ts); users can't write or edit them.

### Family practice calls

An adult child can send a parent a surprise practice call, with guardrails:

- The parent opts in on **their own device** ("Let family send me practice calls", off by default) and shares a family code. They can pause or remove anyone.
- Calls are **queued**, never instant: they ring at a random time inside the parent's own window.
- **Library scenarios only.** The sender picks a story but can't write one or add details.
- **Rate limits:** one family call a day, and none after a failed call until the parent opens the app again.
- **The debrief names the sender** ("Caleb sent you this practice call"). Family sees scores, never transcripts.

## Safety and privacy by design

- **No telephony.** Calls are in-app audio over a WebSocket. Nothing can be pointed at a phone number, so the app is useless to a real scammer.
- **Consent first.** Onboarding explains that an AI plays the scammer and that audio is processed on Nebius, and records consent before any call.
- **Always one tap from out.** A "This is practice · safe word" banner stays on screen for the whole call; tapping it or saying the safe word ends the call with no score.
- **No real brands, no cloned voices.** Caller IDs are generic, the persona prompt forbids real company names, and voices come from a fixed synthetic library.
- **Redaction before storage.** Card numbers, SSNs, account numbers, one-time codes (including spoken digits like "four eight two…"), emails and addresses are replaced with tokens like `[CARD]` in memory, before anything is saved or scored. If a real-looking card or account number is caught, the debrief tells the user to call their bank.
- **Short retention.** Call audio is never written to disk. Transcripts are deleted after 30 days; scores keep only tags and points. "Delete my data" is one tap.

## Architecture

```
 Phone (PWA)                         Hang Up API (Node, Fastify)                 Nebius
 ┌─────────────────────┐  WebSocket  ┌──────────────────────────────┐  HTTPS   ┌──────────────────────────┐
 │ ring / call / debrief│◀──────────▶│ call session                 │────────▶│ Token Factory            │
 │ mic → VAD → PCM16    │ audio up,   │  ├ safe word, barge-in, cap  │ stream  │  Nemotron 3 Super        │
 │ WAV playback queue   │ voice down  │  ├ sentence splitter → TTS   │         │  (scammer + coach)       │
 └─────────────────────┘             │  └ redact → score → debrief  │         └──────────────────────────┘
          ▲   REST                    │ REST: scenarios, history,    │  HTTP   ┌──────────────────────────┐
          └──────────────────────────▶│ settings, family, push       │────────▶│ Speech service (GPU VM)  │
            Web Push (incoming call)  │ scheduler + SQLite           │         │  Parakeet STT, Kokoro TTS│
                                      └──────────────────────────────┘         └──────────────────────────┘
```

Latency comes from streaming every stage: Nemotron's reply is split into sentences as it streams (the first chunk may break at a comma), each sentence is synthesised and sent as soon as it's ready, and the phone plays them back to back.

If the speech service is offline, the app falls back to the browser's built-in speech recognition and voices, so a call always works.

### Repository layout

```
apps/server        Fastify API: WebSocket call session, REST, scheduler, scoring, web push
apps/web           React PWA (Vite): onboarding, ringing, in-call, debrief, history, family, settings
packages/client    Shared TypeScript types + REST client + CallSession (works in browsers, Node and React Native)
services/speech    Python speech service: NVIDIA Parakeet (STT) + Kokoro (TTS) via sherpa-onnx
```

The whole app is behind the API, and `@hangup/client` is platform-agnostic, so a native Expo app can reuse it as-is (audio capture/playback is the only piece each platform supplies).

## Run it locally

Requirements: Node 22.13+, pnpm 10, Python 3.11+ (for the speech service), a Nebius Token Factory API key.

```bash
cp .env.example .env            # add NEBIUS_API_KEY
pnpm install

# speech service (downloads ~1 GB of models the first time)
cd services/speech
pip install -r requirements.txt
./download_models.sh ./models
MODELS_DIR=./models uvicorn app:app --port 8001
cd ../..

pnpm dev                        # API on :8787, web app on :5173
```

Open http://localhost:5173. Microphone access needs `localhost` or HTTPS.

Check the whole voice loop without a browser (Kokoro speaks the "user" lines, Parakeet hears them, Nemotron answers):

```bash
pnpm --filter @hangup/server simulate server bank-code competent
```

Tests: `pnpm test` (redaction, scoring rules, sentence splitting, safe word, timezone windows).

## Deploy

- **Everything on one Nebius AI Cloud VM:** `docker compose up -d --build` runs Caddy (automatic HTTPS), the API (which also serves the built web app) and the speech service. Step-by-step guide: [docs/DEPLOY.md](docs/DEPLOY.md).
- **Free: a Hugging Face Space** runs the web app, API and speech service in one container on the free CPU tier. See [deploy/huggingface](deploy/huggingface/README.md).
- **Web app on Vercel (optional):** deploy `apps/web` (a `vercel.json` is included) with `VITE_API_URL` set to the API's URL, and add the Vercel domain to the API's `CORS_ORIGIN`.

Environment variables are documented in [`.env.example`](.env.example). Keys are only ever read from the environment.

## API

| Method | Path | What it does |
| --- | --- | --- |
| POST | `/api/devices` | Register this install, returns a bearer token |
| GET / PATCH | `/api/me`, `/api/me/settings` | Profile, stats, schedule, safe word, consent |
| GET | `/api/scenarios` | Scenario and persona library |
| POST | `/api/calls` | "Ring me now" (optional scenario and difficulty) |
| GET | `/api/calls/ringing` | A scheduled or family call whose time has come |
| WS | `/api/calls/:id/session` | The live call (protocol in [`packages/client/src/types.ts`](packages/client/src/types.ts)) |
| GET | `/api/calls`, `/api/calls/:id` | History, transcript, score and debrief |
| GET | `/api/calls/:id/debrief.wav` | The coach's spoken debrief |
| POST | `/api/family/link`, `/api/family/parents/:id/calls` | Link with a parent's code, queue a family call |
| POST | `/api/push/subscribe` | Web Push for "incoming call" notifications |

## Roadmap

- Native Expo app on the same API and client package
- Live scam alerts via Tavily turned into new practice scenarios
- Personal and Cold difficulty tiers, supervisor hand-offs with a second voice
- Weekly family report emails

## License

[MIT](LICENSE)
