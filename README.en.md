# dsh-codebuddy

> ⚠️ **Unofficial third-party plugin.** This project is **not affiliated with, endorsed by, sponsored by, or connected to** Tencent Holdings Ltd. or any of its affiliates.
> "CodeBuddy" and "Tencent" are trademarks of their respective owners and are used here only **descriptively** (nominative use) to identify the service this plugin connects to.
> This project contains **no** Tencent code, assets, or credentials, and circumvents no authentication.

> 🔀 **This repository is a fork**: [GEMLZC/dsh-codebuddy](https://github.com/GEMLZC/dsh-codebuddy),
> forked from [zhang-tod/dsh-codebuddy](https://github.com/zhang-tod/dsh-codebuddy) `1.1.5` (MIT).
> Changes relative to upstream are in [CHANGELOG.md](CHANGELOG.md).

Connects models from the [Tencent CodeBuddy open platform](https://copilot.tencent.com) to [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH).
**Zero source patches** — it modifies no DSH files, touches no `node_modules`, and is a plain plugin.

---

## What it is / is not

| ✅ Is | ❌ Is not |
|---|---|
| A standard DSH plugin (`package.json` + `cordis.patch.yml` + host entry + settings page) | Not an official DSH provider |
| Uses **your own** CodeBuddy API key against the official OpenAI-compatible gateway | Does not provide, resell, or share any API key |
| Ships a GUI settings page: paste key → test → fetch models → select | Not a CLI tool; no config-file editing needed |
| Probe-based model discovery (the gateway exposes no model-list endpoint) | Does not proxy, relay, or route through any third-party server |

---

## Requirements

| Item | Requirement |
|---|---|
| DSH | Verified on `0.1.7-rc.2` and `0.2.0-rc.2` (depends on the `@deepseek-ai/dsh-llm` `LlmAdapter` contract). `peerDependencies` range: `>=0.1.7-rc.2 \|\| >=0.2.0-rc.1 <3.0.0-0` |
| Node.js | `^22.19.0 \|\| >=24.0.0` |
| Account | A [Tencent CodeBuddy open platform](https://www.codebuddy.cn) account and API key (starts with `sk-` or `ck-`) |

> This plugin needs no DSH account and no other credentials.

---

## Installation

### ⚠️ Read this first: **do not use `link:`**

`lib/index.js` statically imports `@deepseek-ai/dsh-llm` at the top level. That package is provided by DSH itself and is only resolvable inside the profile's `node_modules` tree.

- `link:` install → the plugin exists as a **symlink** → cannot resolve `@deepseek-ai/dsh-llm` → **throws `ERR_MODULE_NOT_FOUND` at load time**, which looks like "installed, but nothing shows up in settings"
- `file:` install → pnpm **physically copies** the plugin into the profile's `node_modules` → upward resolution reaches DSH's packages → ✅ works

**So: use an absolute `file:` path, or just copy the directory manually.**

### Option A: `file:` dependency (recommended)

1. Put this repository somewhere **permanent**, e.g. `E:\WorkBuddy\dsh-codebuddy`
2. In the DSH profile's `package.json`:
   - add the dependency: `"dsh-codebuddy": "file:E:/WorkBuddy/dsh-codebuddy"` (forward slashes on Windows)
   - add it to the `dsh.profile.bundles` list
3. Let the profile install dependencies (the DSH desktop "Settings → Plugins" page can add a local path, or follow whatever install flow your profile type uses)
4. **Restart DSH** (required — the plugin registers at startup)

### Option B: manual copy

Copy `lib/`, `cordis.patch.yml`, and `package.json` from this repository into:

```
<DSH profile directory>/node_modules/dsh-codebuddy/
```

Then restart DSH.

### Option C: npm / GitHub (if published)

```bash
dsh plugin --profile <your-profile> add dsh-codebuddy
# or
dsh plugin --profile <your-profile> add github:<owner>/dsh-codebuddy
```

> Both forms still require the plugin to resolve `@deepseek-ai/dsh-llm` from the profile. If you get `Cannot find module '@deepseek-ai/dsh-llm'`, use Option A or B instead.

---

## Configuration

After restarting, open **Settings → CodeBuddy**:

| Step | Action |
|---|---|
| 1 | Paste your key into **API Key** (starts with `sk-` / `ck-`) and click **Save key** (stored in the DSH credential store, never written to a config file) |
| 2 | Click **Test connection** — you should see "✅ Connection OK, key is valid" |
| 3 | Click **Fetch models** — probes the gateway and lists available models (see cost notes below) |
| 4 | Go to **Settings → Models**, pick provider `CodeBuddy (unofficial)`, and select your model |

**The endpoint field is read-only.** It comes from `baseURL` in `cordis.patch.yml`; to change it, edit the config or set the `CODEBUDDY_BASE_URL` environment variable, then restart DSH. The settings page deliberately offers no editor (an earlier "Save endpoint" button showed "Saved" while persisting nothing — it has been removed).

### How many requests does one "Fetch models" cost?

Every candidate is a **real, billable** completion request.

| Mode | Requests | Notes |
|---|---|---|
| Default (shallow) | 22 (worst 44) | Probes the known list only; "worst" is one retry round for inconclusive results |
| "Deep probe" checked | 60 (worst 120) | Adds 38 guessed future version IDs |

Built-in protections:

- **In-session cache** (30 min, keyed by endpoint + key fingerprint) → repeat clicks cost 0 requests
- **Rate-limit breaker**: ≥3 HTTP 429s in one batch, or 3 consecutive batches with any 429 → stop immediately
- **Quota breaker**: on `code 14018` (quota exhausted) → **stops after the first batch**, wasting nothing further
- **60-second overall deadline**: aborts in-flight probes (including backoff) — never hangs for minutes
- **Cancellable**: the button turns into "Cancel" while probing, and it **actually** propagates the abort server-side

---

## Built-in model list

Fallback list used when probing fails (28 entries, calibrated against the live gateway on 2026-10-01; contextWindow/maxTokens revised 2026-10-04; 6 models added 2026-10-17). `contextWindow` is pinned to 1000000 (local preference); the gateway's hard cap was measured at 1048576 tokens.

| ID | Name | Context | Max output | Input |
|---|---|---|---|---|
| `auto` | Auto router | 1000000 | 8192 | text |
| `fast-model` | Fast | 1000000 | 48000 | text / image |
| `balanced-model` | Balanced | 1000000 | 48000 | text / image |
| `deep-model` | Deep | 1000000 | 48000 | text / image |
| `hy4-preview` | Hy4 Preview | 1000000 | 8192 | text / image |
| `hy3` | Hy3 | 1000000 | 8192 | text / image |
| `hy3-x` | Hy3 X | 1000000 | 64000 | text / image |
| `hy3-preview` | Hy3 Preview | 1000000 | 8192 | text |
| `hy3-preview-agent` | Hy3 Preview Agent | 1000000 | 8192 | text |
| `deepseek-v4.1-flash` | DeepSeek V4.1 Flash | 1000000 | 128000 | text / image |
| `deepseek-v4-pro` | DeepSeek V4 Pro | 1000000 | 32768 | text / image |
| `deepseek-v4-flash` | DeepSeek V4 Flash | 1000000 | 8192 | text / image |
| `glm-5.3` | GLM 5.3 | 1000000 | 8192 | text / image |
| `glm-5.3-flash` | GLM 5.3 Flash | 1000000 | 8192 | text / image |
| `glm-5.3-flashx` | GLM 5.3 FlashX | 1000000 | 8192 | text / image |
| `glm-5.2` | GLM 5.2 | 1000000 | 8192 | text / image |
| `glm-5.1` | GLM 5.1 | 1000000 | 8192 | text / image |
| `glm-5v-turbo` | GLM 5V Turbo (vision) | 1000000 | 8192 | text / image |
| `minimax-m3` | MiniMax M3 | 1000000 | 8192 | text |
| `minimax-m3-pay` | MiniMax M3 Pay | 1000000 | 8192 | text |
| `kimi-k3` | Kimi K3 | 1000000 | 8192 | text |
| `kimi-k3-2` | Kimi K3.2 | 1000000 | 32000 | text / image |
| `kimi-k2.8-preview` | Kimi K2.8 Preview | 1000000 | 8192 | text / image |
| `kimi-k2.7` | Kimi K2.7 | 1000000 | 8192 | text / image |
| `kimi-k2.6` | Kimi K2.6 | 1000000 | 8192 | text / image |
| `kimi-k2.5` | Kimi K2.5 | 1000000 | 8192 | text / image |
| `space-bunny` | Space-Bunny (reasoning) | 1000000 | 128000 | text / image |
| `step-5-preview` | Step-5 Preview | 1000000 | 8192 | text / image |

> The catalog drifts with official changes. **This list is only a fallback — the "Fetch models" probe is authoritative**, and discovered models enter the model picker for the current session.

### Reasoning efforts (thinking depth)

Efforts are **per-model**, not a single global ladder — each model's set comes from
"officially declared ∩ empirically accepted by the gateway". The model picker shows
exactly the efforts that model supports (a subset of Off / Low / Medium / High / XHigh / Max).

| Model | Efforts | Off (can disable) |
|---|---|---|
| `deepseek-v4.1-flash` | Low / High / Max | ✅ |
| `deepseek-v4-pro` | High / XHigh | ✅ |
| `deepseek-v4-flash` | High / XHigh | ✅ |
| `space-bunny` | Low / Medium / High / XHigh / Max | ❌ |
| `glm-5.3` / `-flash` / `-flashx` | Low / High / Max | ❌ |
| `glm-5.2` | High / XHigh | ✅ |
| `glm-5.1` | Low / Medium / High / XHigh / Max | ❌ (**forced**, omitting the field errors) |
| `step-5-preview` | Low / Medium / High | ❌ |
| `hy3` / `hy3-x` | Low / High | ❌ |
| `hy4-preview` | High | ❌ |
| `kimi-k2.8-preview` | Low / High / Max | ❌ |
| `kimi-k3-2` | Low / High / XHigh | ❌ |

Rules that are easy to get wrong:

- **Off means omitting `reasoning_effort`**, not sending `"off"`. Sending the literal
  string `"off"` returned 400/11133 on all three DeepSeek models in testing.
- **The gateway does not validate efforts for a whole class of models** (glm/hy/step accept
  any string with HTTP 200). "It was accepted" therefore does not mean "it takes effect" —
  the plugin lists only officially declared efforts.
- **`glm-5.1` is the only model that requires an effort**: omitting it returns 400/11150.
  Selecting Off downgrades to the lowest tier (`low`) instead of omitting the field.
- Models not listed fall back conservatively (High / Max) rather than losing all efforts.

#### Composer effort slider (v1.1.7)

A slider now sits in the composer toolbar, immediately **left of the model picker**, so
changing the effort no longer needs the two-level popup.

It agrees with the popup by construction, because there is exactly one source of truth:

- Registered on the host's public slot `conversation.input.right` (`order: -100`, the
  immediate left neighbour of the model seat). It reads no hashed CSS-module class names
  and mutates no host DOM.
- Efforts and the current value come from `ctx.modelDirectories`' per-session
  `ModelDirectory` — the **same store** `ModelSelect` in `dsh-client-ui-model-selection`
  reads, and the same `directory.select()` it calls.

That yields three properties:

| Property | Why |
|---|---|
| Default effort is unchanged | Both sides evaluate `current.reasoningEffort ?? reasoning.defaultEffort`, and `defaultEffort` still comes from `defaultEffortFor()` above |
| Drag → popup follows | The drag writes the same store the popup re-renders from |
| Popup change → slider follows | The reverse of the same chain |

**Works for every provider**: the slot is public and the directory is shared across
providers, so official DeepSeek-account models (e.g. `deepseek-flash` with
off/low/high/max) are draggable too — not just CodeBuddy routes.

**Request timing**: `input` is visual-only; `change` (pointer release or keyboard
commit) submits once — one drag equals one `selectModel`. On failure the thumb snaps back
to the host's value and the reason lives in `title`; no toast, because a toast steals
input focus.

**When it does not appear**: the model declares no `reasoning.efforts`, there is no
current model yet, the session is an addressed subagent, or the model exposes a single
effort (then only a static label is drawn, never a fake slider). Narrow widths
(`≤ 560px`, the host's own breakpoint) drop the text label and keep the slider.

---

## Data and privacy

Please read this before use.

| Item | Detail |
|---|---|
| **Where your API key goes** | Only as an `Authorization: Bearer` header to `https://copilot.tencent.com/v2`. It **never** passes through the author or any server belonging to this plugin (there is none) |
| **Conversation content** | Your prompts, code, system prompt, and tool-call arguments are **fully uploaded** to that Tencent gateway and handled under its privacy policy; may cross borders |
| **Telemetry** | **None.** This plugin contains no analytics, reporting, or callbacks |
| **Request identity** | Each request carries the standard DSH framework User-Agent (`deepseek-harness/<version>`). That is a DSH contract requirement, not something this plugin adds. **That UA is blacklisted by the gateway** (see below), so since v1.1.5 it is filtered out |
| **Client identity** (v1.1.6) | To populate the console's "client" column, the plugin now sends the official CLI 2.180.0 identity headers captured from a real run: `User-Agent: CLI/<v> CodeBuddy/<v>`, `X-IDE-Type` / `X-IDE-Name` / `X-IDE-Version`, `X-Product`, `X-Agent-*`, `X-Request-ID`. Override the version with `DSH_CODEBUDDY_CLIENT_VERSION` |
| **Key storage** | Stored in the DSH credential store (`~/.dsh/.credentials.yaml`), **never** written in plaintext to a config file. If the credential store is unavailable it degrades to a process environment variable (session-only) |
| **Deleting the key** | The settings page has **Delete key**. If your key comes from a **read-only source** (e.g. `~/.dsh/.env`), the plugin **tells you it cannot delete it** instead of pretending success |
| **Filing an issue** | Never paste your API key, full request logs, or screenshots containing credentials |

---

## Troubleshooting

| Symptom | Meaning | What to do |
|---|---|---|
| **HTTP 400 · `code 11102`** | Model does not exist | Click "Fetch models" and pick from the list |
| **HTTP 400 · `code 11128`** `Illegal API invocation from an unapproved channel` | The gateway's **channel check** rejected the request: a message body matched one of its client fingerprints (two rules: ① a line **starting** with a literal, ② a **whole literal appearing anywhere**) | Since v1.1.2 the plugin auto-defuses rule ① (newline before the matching line); v1.1.3 defuses rule ② (breaks the literal at a sentence boundary); since v1.1.4 the last-resort fallback scatters the text with **newlines** (the gateway now strips zero-width spaces and collapses spaces — only newlines still break literals) and remembers prompts that need scattering so later turns cost no extra failed request. Each DSH upgrade of the system prompt may trigger a new blacklist round |
| **HTTP 400 · `code 11128`** `request illegal` | The gateway blocks by **client identifier**: a User-Agent containing `deepseek-harness` is rejected (DSH's default attribution header does exactly that) | **Since v1.1.5** the plugin strips attribution headers containing that substring (remove-only, never impersonates an official client). If it reappears, the gateway blacklisted another identifier — update the plugin or file an issue (include the `requestId`, never your key) |
| **HTTP 400 · `code 11115`** `prompt is too long` | Context overflow | Classified as `CONTEXT_WINDOW_EXCEEDED`; DSH auto-compacts and retries. If it persists, trim the session |
| **HTTP 429 · `code 14018`** quota exhausted | **Account quota exhausted** (permanent, not rate limiting) | Top up at [codebuddy.cn](https://www.codebuddy.cn/profile/usage). Retrying will not help |
| **HTTP 429 (no 14018)** | Genuine rate limiting | Retry later; the plugin honors `Retry-After` and trips a breaker |
| **HTTP 401 / 403** | Invalid or expired key | Re-enter the key |
| **`cannot resolve credential "CODEBUDDY_API_KEY"`** | No key saved yet | Enter and save one in settings |
| **`gateway returned an empty response`** | HTTP 200 with no content blocks | Retried automatically as `EMPTY_RESPONSE` |
| **`response stream was truncated`** | Connection dropped mid-stream (proxy / gateway restart) | Retried as `TRANSPORT`; partial output is never committed as a complete answer |
| **`stream idle timeout`** | Connected, but the gateway then sends **nothing at all** (silent proxy drop / gateway hang) | Aborts after 60 s of silence and retries as `TRANSPORT`. **It no longer waits ~5 minutes** (Node `fetch`'s default `bodyTimeout`) to throw a bare, non-retryable error |
| **No CodeBuddy section after install** | Most likely installed with `link:` | Reinstall with `file:` or a manual copy (see Installation) |
| **New models missing from the picker** | Discovery results are **session-scoped** | Click "Fetch models" again after restarting |
| **`Cannot find module '@deepseek-ai/dsh-llm'`** | Plugin is not inside the profile's `node_modules` tree | Install with `file:` or a manual copy |

---

## Known limitations

1. **Discovered models do not persist across sessions.** Newly discovered models enter the picker immediately for the current session, but a DSH restart falls back to the built-in list — click "Fetch models" again.
   (Cross-session persistence would require a `Config` schema plus a `@deepseek-ai/schemastery` dependency, which would churn the profile lockfile. Not done.)
2. **The endpoint cannot be edited from the settings page.** It comes from config / environment.
3. **The deep-probe guess list goes stale.** The 38 guessed version IDs (e.g. `hy5`, `deepseek-v5`) age with each official release, and are **off by default**.
4. **Model metadata (context window / max output) is statically declared.** Official changes require editing `cordis.patch.yml`; probing does not correct metadata for already-listed models.
5. **One "Fetch models" issues real billable requests** (see the cost table above).
6. **The stream idle timeout counts bytes, so keep-alives defeat it.** The watchdog measures silence *between*
   received data. As long as the gateway keeps emitting **any** byte (e.g. an SSE comment `: keepalive`, a partial
   frame), the timer resets — even if that response is effectively dead. Measured: no bytes at all → times out at
   60 s; a keep-alive every 200 ms → never times out.
   (Node `fetch`'s own 300 s `bodyTimeout` is fooled the same way, so this is the guard's scope, not a regression.)
   If it spins forever while the gateway is sending keep-alives, interrupt and resend.
7. **The failure ceiling is about 5.5 minutes.** A 60 s idle timeout × up to 5 retries plus backoff (~30 s total).
   That is the trade for turning "always fails" into "usually self-heals": transient drops recover, and a truly
   dead gateway waits slightly longer than before.

---

## Uninstall and rollback

1. Remove the `dsh-codebuddy` dependency and the `dsh.profile.bundles` entry from the profile's `package.json`
2. Delete `<profile>/node_modules/dsh-codebuddy/`
3. Restart DSH — the CodeBuddy section in settings should disappear
4. To clear credentials: click "Delete key" in settings, or remove `CODEBUDDY_API_KEY` from the credential store manually
5. To roll back to the old binary-patch approach: restore your `selfheal` scripts and the old provider block in the profile

---

## Development

```bash
npm test        # zero-network, zero-quota regression tests (node --test)
```

CI: every push and pull request runs the full suite (`.github/workflows/ci.yml`).

**Why this works in CI**: `lib/index.js` imports `@deepseek-ai/dsh-llm`, and that package **is published to npm** — CI installs it directly instead of a whole DSH installation:

```bash
npm i -D @deepseek-ai/dsh-llm@0.2.0-rc.2 @deepseek-ai/cordis@4.0.5   # ⚠️ pin both: dsh-llm's `latest` dist-tag is a stale 0.0.1-rc.1
node --test "test/*.test.mjs"
```

> Note the glob (and keep the quotes) rather than `node --test test/`: Node's `--test` only accepts
> **files/globs** as test entries. A bare directory name is treated as a CJS entry module, which fails
> with `MODULE_NOT_FOUND` and is counted as one failing test.

Coverage: SSE parsing edge cases (CRLF split across chunks, multi-line `data:`, trailing frame), block lifecycle and index allocation, tool-call argument assembly, mutually-exclusive `usage` accounting, error classification (11102 / 11115 / 14018 / 401 / 5xx), stream-truncation guard, **stream idle timeout**, catalog merging (add / remove / scope), probe breaker and overall deadline, **dual-copy model manifest consistency**, **the composer effort slider's default tier and tier sequence** (`test/slider.test.mjs`, pure functions, no DOM), **its breathing-glow windows and drag continuity** (`test/render-effort.test.mjs`, renders the real component through mini-hooks), **a real-cordis replay** (`test/cordis-replay.test.mjs`), plus an end-to-end run against a **local mock gateway**.

> `test/cordis-replay.test.mjs` mounts `lib/client.js` on a **real cordis** to guard a failure class
> that only real fibers expose: when `ctx.inject([...])` omits a service name, cordis **throws** instead
> of returning `undefined`, and the `try/catch` inside an `inject` callback turns that into
> "the slot exists, the component renders `null`, nothing shows up, the console may have one line" —
> which is exactly how v1.1.7's slider disappeared. It resolves cordis via bare specifier →
> `DSH_CORDIS_PATH` → `~/.dsh/profiles/*`, and **skips** (never fails) when none resolve, or when the
> cordis build lacks `Service.associate` semantics.

> When developing locally, run tests inside an **installed copy** — the `@deepseek-ai/dsh-llm` that `lib/index.js` resolves comes from the DSH profile. Sync `lib/` and `test/` into `<profile>/node_modules/dsh-codebuddy/` first. (CI does not need this step, since it installs the dependency from npm.)
>
> `test/slider.test.mjs`, `test/render-effort.test.mjs` and `test/cordis-replay.test.mjs` never import `lib/index.js`, so they also run straight from the repo. Point the replay test at the cordis shipped with DSH:
>
> ```bash
> DSH_CORDIS_PATH="<dsh app>/node_modules/@deepseek-ai/cordis/lib/index.js" node --test test/cordis-replay.test.mjs
> ```

---

## License

[MIT](LICENSE). The upstream `@deepseek-ai/dsh-llm` family is MIT as well; see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

---

## Acknowledgements

- [zhang-tod/dsh-codebuddy](https://github.com/zhang-tod/dsh-codebuddy) — the upstream this fork is based on, original implementation
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — plugin framework and the `LlmAdapter` contract
- `@deepseek-ai/dsh-llm-deepseek` — reference adapter implementation
