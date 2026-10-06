# Model providers and the editing assistant

## What it does

The 大模型助手 (LUI) uses a server-side, OpenAI-compatible Chat Completions tool-calling adapter. DeepSeek and OpenAI are optional presets; custom public HTTPS providers and normal model identifiers are supported. The existing offline keyword story generator remains separate. A compatible service must implement Bearer authentication, `POST /chat/completions`, assistant `tool_calls`, and tool-result messages. A key for a different native API (for example an Anthropic Messages-only or Gemini-native endpoint) is not automatically compatible. A model can stage nine typed editor commands:

- `paint_terrain`: paint a bounded rectangle using a verified native terrain ID
- `set_elevation`: set actual exported native tile heights, from 0 through 16
- `place_objects`: place verified native catalog units, buildings, and decorations
- `move_objects`: move existing unlocked objects
- `remove_objects`: propose object deletion
- `generate_map`: generate a seeded river, highland, or coast map using the deterministic local generator
- `add_story`, `edit_story`, `remove_story`: manage supported timed dialogue, camera, movement, and victory nodes

Every write-tool response explicitly reports **queued, not applied**. The model receives these tool results in the next completion. The editor independently validates all returned commands, simulates the complete transaction, displays its before/after map and exact parameter list, and waits for the user to apply it. The existing editor commit history owns the undo transaction.

No tool can run code, shell commands, arbitrary scripts, files, URLs, API requests, custom AI programs, unsupported object IDs, or unimplemented story triggers. Arrival/death conditions and branching dialogue are not implemented. The assistant must explain these limits rather than fabricate working triggers.

## Provider settings and URL convention

Configure the entire session together: `{ providerName, baseUrl, model, key, preset? }`. Configuration does not make a network/API request. Every replacement requires a new key in the local masked input, so an old provider key is never silently reused for a changed destination. The status and settings display the normalized destination and configured model; saving only confirms local configuration, not live account connectivity.

- DeepSeek preset: `https://api.deepseek.com`, suggested `deepseek-flash` or `deepseek-v4-pro`. Its official `/v1` base is also accepted.
- OpenAI preset: `https://api.openai.com/v1`, suggested `gpt-4.1-mini`.
- Custom: enter the provider's complete API base, including any required version/path prefix, and its model identifier. Models are editable for every preset. Suggestions are not a guarantee of account access or future availability.
- There is **no implicit `/v1` insertion or removal**. Remove trailing slashes and append exactly `/chat/completions`: `https://api.provider.com/v1/` becomes `https://api.provider.com/v1/chat/completions`; `https://api.provider.com/compatible-mode/v1` retains that whole prefix.
- Enter an API base, not a full Chat Completions endpoint. Full `/chat/completions` URLs, embedded credentials, queries/fragments, percent encoding, backslashes, dot-path traversal, and non-HTTPS URLs are rejected with static errors.
- An official preset is accepted only for its official base. A changed host/path requires Custom and its own key. A custom provider's display name is user-provided; it does not establish trust or official affiliation.
- Only the verified DeepSeek preset adds `thinking: { type: "disabled" }`. OpenAI and Custom send only ordinary Chat Completions fields; no DeepSeek-specific options are added. Models/providers requiring other parameters or a different tool protocol are outside this adapter's compatibility boundary. Unsupported format/tools errors explain this without relaying provider response bodies.

The disconnected state has blank provider, base URL, model, and endpoint, plus optional preset choices. Nothing is selected or configured implicitly.

## API contract

- `GET /api/lui/status`: `{ configured, providerName, baseUrl, model, preset, endpoint, presets, storage: "session-memory", sessionRevision }`; never a key.
- `POST /api/lui/session`: `{ providerName, baseUrl, model, key, preset? }`; atomically replace all session settings.
- `POST /api/lui/session/clear`: `{}`; disconnect and discard all session settings.
- `POST /api/lui/cancel`: `{ requestId }`; cancel only that in-flight request.
- `POST /api/lui/chat`: `{ requestId, messages, context, sessionRevision }`; model and destination come exclusively from the captured server session, not the chat body.
  - `requestId`: client-generated UUID used only by the local service, stripped before provider invocation.
  - `sessionRevision`: exact safe-integer revision last read from local status. The service starts with a cryptographically random 52-bit epoch and increments on each configure/clear, preventing old browser-tab history from being accepted after a local-service restart or provider/key change.
  - `messages`: bounded `{ role: "user" | "assistant", content }` history, ending in a user request.
  - `context`: the allowlisted result of `makeProjectContext`, never a raw Project.
  - response: `{ message, commands, toolResults, model, sessionRevision, usage: { promptTokens, completionTokens }, rounds }`.

The service API is `ProviderService.configure(configuration)`, `.clear()`, `.status()`, and async `.chat(payload)` in `server/provider.py`. `ProviderError` contains only a fixed safe message and `status_code`. The old `server.deepseek` module contains import aliases only; it has no key-only configuration flow or separate transport. The HTTP layer enforces the existing local host/origin guard, body limits, request cancellation, and same-origin requirements. Metadata fields are validated separately and cannot contain the configured key or likely credential strings. Validation does not reflect bad inputs or secrets in error messages.

## Credential boundary

Enter a newly issued key only in the local desktop settings form. Do not paste a credential into the chat, source code, a project, a screenshot, or a bug report. The settings form is uncontrolled/masked and clears its input after submitting. The server stores the key only in process memory through `SecretStr`; it never writes a file, environment variable, project, browser storage, log, exported file, or response with the key. Closing the local service discards the credential. Python cannot guarantee forensic zeroization of previously allocated strings; this is session-only storage, not a hardened secret vault.

The renderer's chat and project state do not receive the API key. The key is sent only as the HTTPS Authorization header to the explicitly configured destination. Destination, key, model, and revision are captured from one immutable session snapshot; there is no fallback that sends the same key to another provider. Redirects are disabled, environment proxy settings are not used, upstream HTTP response bodies are never relayed as error details, and the known session secret is redacted if upstream echoes it in text. A key echoed in tool arguments aborts the request.

The hosted static preview performs zero LUI API requests and has no key-entry flow. Use the local app/full local service. Optional persistent credential storage is not implemented; it would require a separate explicit opt-in and OS-secure storage.

## Public-only destination and DNS-rebinding boundary

Production calls use a per-chat `PinnedHTTPSTransport`, based on the documented HTTPX public transport interface and `sni_hostname` extension:

1. Validate the HTTPS base and reject loopback, private, link-local, multicast, reserved/internal names, cloud metadata targets (including Azure's `168.63.129.16`), and unsafe IPv4/IPv6 translation/tunnel forms.
2. Resolve DNS once per chat with a timeout. Validate **every** result; mixed public/private answers fail closed. Keep a single verified public numeric IP for every tool round.
3. Send the actual HTTPX request to that numeric IP, while retaining the original destination in the HTTP `Host` header and TLS SNI/certificate-hostname verification. The underlying connector cannot resolve the provider hostname a second time, so a changed DNS answer cannot redirect this request to an internal address.
4. Keep normal certificate trust/hostname checks enabled. The transport rejects any other URL/method and does not share a connection pool across chats, configurations, or hosts. It checks the session revision again after DNS completes, before sending a key.
5. Disable redirects, proxy/environment configuration, and transport retries. A redirect fails visibly; the credential is not forwarded. Private/on-premises/local model servers and providers that require an environment proxy or special trust bundle are intentionally unsupported.

This is transport-level pinning, not a DNS-only preflight followed by an unchecked hostname connection. The operating system's routing and installed application code remain trusted; this is not a sandbox against a compromised machine. Direct public-IP bases need a valid certificate for that IP. Connection failure is reported without automatically trying different providers or billed requests.

## Data sent to the selected provider

The UI explains transmission before the first request. A conservative accidental-credential detector clears likely API keys from the composer before conversation storage or transmission; the server independently rejects likely credentials in chat messages. This detector is a convenience safeguard, not a general secret scanner. Outbound data consists of the recent conversation, project name, dimensions, terrain counts, coarse 12×12-or-smaller tile samples, up to 150 objects (selected object first), up to 40 supported story nodes, and the server's trusted native catalog. Object labels and story text are included because the model needs them to address edits. The full terrain grid, native scenario bytes, original filename, custom AI program, unrecognized project fields, and local files are not sent. The context explicitly includes totals so the model can recognize omitted objects/story nodes.

The server treats project names, labels, and story text as untrusted content and never converts them to system instructions or capabilities. All tools are closed-schema and independently validated. Requests for absent IDs should be narrowed or supplied through editor selection.

## Review and safety behavior

- Preview is pure and atomic: one invalid command rejects the entire proposal with no partial edits.
- Apply revalidates commands instead of trusting a cached preview snapshot.
- A content fingerprint catches edits made while the model is thinking, even if the project timestamp stayed unchanged. Stale proposals cannot be applied.
- All edits require clicking Apply. Deletion, story replacement, and map regeneration additionally require a destructive-change checkbox.
- Regeneration replaces the map and objects and clears supported story. It must be the first command, can appear at most once, and is blocked in imported native projects.
- Locked objects cannot be changed. Imported native objects cannot be deleted by the LUI because hidden native trigger references may depend on them.
- The local validator checks native object footprints, map coordinates, story references, player ownership, allowed terrain/object IDs, and project validity.
- Removing an object referenced by a remaining movement node is rejected.
- Stop sends an explicit `POST /api/lui/cancel` targeting the original request UUID and also aborts the browser request. Project switches/unmounts do the same for an active request. This does not assume Chromium custom-protocol abort propagation. A late cancellation cannot cancel a newer request, and late replies are discarded. If the three-second cancellation acknowledgement fails, the UI reports that local-service cancellation is unconfirmed. Cancellation cannot undo provider processing already received upstream or promise a billing refund. No project change occurs without Apply.
- The service limits work to five model rounds, 24 tool calls, one in-flight request, a three-minute total request timeout, bounded messages/context/response sizes, and 4,096 output tokens per model call. The client engine limits proposals to 24 commands and 500,000 tile operations.
- Tool validation failures are returned to the model for correction, but exhausted budgets/incomplete/malformed responses do not yield a partial proposal.
- Rate limits, account balance, missing/invalid keys, network failures, and malformed output have visible errors. No automatic costly retry loop runs.

These checks do not prove gameplay pathfinding, unit placement, or current-build compatibility. Exported native scenarios still require game testing.

## Official documentation checked on 2026-10-05

- [DeepSeek current model names and API base](https://api-docs.deepseek.com/guides/tool_call)
- [DeepSeek Chat Completions schema](https://api-docs.deepseek.com/api/create-chat-completion/)
- [DeepSeek tool-call sequence](https://api-docs.deepseek.com/guides/tool_calls/)
- [OpenAI GPT-4.1 mini, Chat Completions and function calling](https://developers.openai.com/api/docs/models/gpt-4.1-mini)
- [HTTPX explicit-IP connections with original Host and verified TLS SNI](https://www.python-httpx.org/advanced/extensions/#sni_hostname)
- [HTTPX custom transports and MockTransport](https://www.python-httpx.org/advanced/transports/)

Implementation uses non-streamed Chat Completions and ordinary function schemas, not vendor SDKs or a provider's beta strict-schema endpoint. Closed local validation is mandatory even when tool schemas are supplied upstream.

## Testing and verification limits

Run:

```sh
npm test -- --run tests/lui.test.ts
.venv/bin/python -m pytest tests/test_provider.py tests/test_provider_transport.py tests/test_deepseek.py -q
npm run build
```

Provider-loop tests use `httpx.MockTransport` and intentionally fake placeholders for DeepSeek, OpenAI, and a second custom provider. Transport tests control DNS and socket/TLS I/O, including a real HTTPX/HTTPCore wire-translation path whose connector sees only a pinned numeric IP. Assertions cover original Host/SNI, `CERT_REQUIRED` plus hostname validation, disabled environment proxies/trust overrides, mixed/private DNS, rebinding, per-chat pinning, and session replacement during DNS. Other tests cover complete assistant/tool-message loops, malformed/unsupported-tool repair, strict typed validation, finite budgets, sanitized errors, secret non-disclosure, cancellation, restart-safe history isolation, and atomic destination/key/model replacement. No test uses a real API credential or production API call.

A live provider account call is a separate validation step after the user securely configures a new key. Mock success must not be described as live-account verification or as an in-game test.
