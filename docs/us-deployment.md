# Private GitHub repo and Render Oregon setup

Status: ready to deploy; **not deployed or US-measured**. The user is creating the accounts. A localhost/tunnel is not US hosting. No paid instance has been created.

## Repo layout

Create an **empty private GitHub repository**. After the final implementation commit, run `npm run voice:deploy:prepare`. Copy the CONTENTS of the resulting `.data/deploy/runtime-*` folder to the private repo root, with this layout:

```text
app/ components/ lib/ voice/
public/voice-capture.js
public/voice-audio/manifest.json + thirty .pcm files
scripts/voice-server.ts
scripts/import-menu.mjs
scripts/prerender-voice-audio.ts
package.json  package-lock.json
next.config.mjs  tsconfig.json  next-env.d.ts
render.yaml  .gitignore  .gitattributes  deployment-manifest.json
```

The runtime bundle includes the approved final menu and the current engine. It excludes original held-out cases, graders, all evaluation fixtures, `.env.local`, recordings, transcripts, private CSVs and model caches. Start a new repo from that folder; do not push the development repo's history containing eval data. Git commands must run inside the new repo folder. The included `.gitignore` excludes `.env.local` and `/.data/`.

Provide the private repo URL when ready. For dashboard deployment, link your GitHub account to Render and grant access only to this repo. No GitHub token or Render API key is needed in the app. If you want this agent to deploy, connect Render and repository access; keep credentials out of chat. Otherwise provide the resulting HTTPS URL for measurement.

## Exact service settings

| Setting | Value |
|---|---|
| Service | Web Service, Node runtime |
| Region / plan | Oregon / Free |
| Branch / root directory | main / empty (repository root) |
| Node | 24.19.0 |
| Build | `npm ci --include=dev && npm run build` |
| Start | `npm run start:voice` |
| Health check | `/voice-health` |
| Automatic deploy | off; deploy reviewed commits manually |
| Browser page | `/voice` |
| WebSocket | `/ws/voice`, same HTTPS origin using WSS |

The supplied `render.yaml` defines these settings. Render supplies `PORT`; the server binds `0.0.0.0:$PORT`. Do not use `next start`: that does not start the custom WebSocket server.

Set these SECRET environment variables privately in Render:

```text
DEEPGRAM_API_KEY
VOICE_DEMO_ACCESS_TOKEN
```

The Blueprint generates `VOICE_DEMO_ACCESS_TOKEN`; for manual setup generate a random private code of at least 24 characters. Enter it only in the page's password input. It never belongs in a URL, Git, screenshot, log or CSV. Invalid access cannot open STT.

The Blueprint sets this non-secret configuration:

```dotenv
NODE_ENV=production
NODE_VERSION=24.19.0
VOICE_DEPLOYMENT_LABEL=US-hosted
VOICE_TTS_PROVIDER=aura-2
VOICE_FIXED_AUDIO_CACHE=true
VOICE_ENDPOINT_MODE=adaptive
VOICE_ACKNOWLEDGEMENT=true
VOICE_STATE_KEYTERMS=true
VOICE_FAQ_ENABLED=false
VOICE_PERSIST_LOGS=false
```

Leave `VOICE_ADAPTIVE_COMPLETE_MS` unset to use the measured model-specific waits. Engine speculation has been removed; old speculation flags have no effect. No Groq, Gemini, Anthropic, Vapi, Twilio or Kokoro key is required.

## Build assets, privacy and measurement

`npm run build` validates the menu, then pre-renders/checks fixed synthetic audio before building Next. The thirty reviewed static assets are in the bundle, so an unchanged build reuses them without synthesis API requests. Missing/new text needs Deepgram credits at BUILD time. Runtime startup verifies hashes and loads PCM; it never generates Aura templates at startup. This removes the previous sixteen-second synthesis warm-up. Static speech contains only templates, final-menu names and modifiers; **no caller audio or transcript**.

The server never writes caller audio, transcripts or mishearings to disk or stdout. Setting `VOICE_PERSIST_LOGS=true` refuses startup. In-memory call state is cleared on disconnect. The browser holds redacted logs and user-entered corrections in the tab; CSV exports are saved only when you choose. Save privately and delete within thirty days. Deepgram processing uses `mip_opt_out=true`; effective opt-out billing remains account-specific.

For the same Lahore browser, add these locally to ignored `.env.local` after deployment:

```text
VOICE_US_BASE_URL
VOICE_DEMO_ACCESS_TOKEN
```

Use `npm run voice:smoke -- --credits-confirmed --latency-ab --us`. Run warm measurements after readiness; preserve region and deployment-manifest commit. Measure the first readiness request separately. The HTTP health check exposes application startup/cache-load time; a new deploy's build time, application startup and Render idle wake are separate quantities. US latency/cold-start numbers remain unmeasured until an actual deployment exists.

Render documents fifteen-minute idle spin-down and roughly one-minute wake-up on Free; those are provider statements, not this project's measurements. No artificial keepalive or paid upgrade is configured. [Render web services](https://render.com/docs/web-services), [Free limits](https://render.com/docs/free), [Blueprint fields](https://render.com/docs/blueprint-spec).
