# LM Studio integration notes

Staffroom connects to LM Studio's OpenAI-compatible server at
`http://localhost:1234/v1` by default. The API key is optional: a plain LM
Studio server accepts a bearer token, while a server protected by LM Studio's
API-key setting or a reverse proxy uses the key stored with the local
credential.

## Endpoints used

| Endpoint                    | Purpose                                                                          |
| --------------------------- | -------------------------------------------------------------------------------- |
| `GET /v1/models`            | List model ids for the Settings UI.                                              |
| `POST /v1/chat/completions` | Run streamed agent turns through the OpenAI Chat Completions protocol.           |
| `GET /api/v0/models`        | Read LM Studio-native metadata, especially each model's `loaded_context_length`. |

The native endpoint is rooted at the server origin, not beneath `/v1`. Given
`http://localhost:1234/v1`, it is `http://localhost:1234/api/v0/models`.

## Why concrete model metadata matters

Flue can synthesize an unknown model from `flue.dynamicModelTemplate`, but its
current fallback metadata is deliberately zeroed:

```text
contextWindow: 0
maxTokens: 0
```

That is unsuitable for LM Studio. pi-ai turns the zero output limit into a
one-token completion. A reasoning-capable model can spend that single token in
`reasoning_content`, then end with `finish_reason: "length"` and no visible
`content`. The UI consequently shows an empty assistant message even though LM
Studio says the completion streamed successfully.

Staffroom must therefore register concrete models, not rely on that dynamic
fallback. `fetchLmStudioModelCatalog()` reads `/api/v0/models`; each discovered
model is registered with:

- its `loaded_context_length` (or `max_context_length`, then a 32,768-token
  fallback for a generic OpenAI-compatible server), and
- an 8,192-token maximum completion budget.

For example, the observed `qwen/qwen3.8-27b` instance reported
`loaded_context_length: 262144`, so an agent prompt around 6,400 tokens has
ample room to reply. The provider must preserve that number when it registers
the model.

LM Studio may advertise a publisher-qualified id such as
`qwen/qwen3.8-27b`, while older Staffroom agent rows contain the bare final
segment, `qwen3.8-27b`. Staffroom registers the bare form as an alias when it
matches exactly one catalog model; an ambiguous bare id intentionally has no
alias.

## Diagnostics

An empty response is not, by itself, evidence that LM Studio has too small a
context window. Check the persisted turn or trace:

| Signal                                                                | Meaning                                                        |
| --------------------------------------------------------------------- | -------------------------------------------------------------- |
| `finish_reason: "length"`, output `0`, and a model with zero metadata | A provider-registration output-cap bug.                        |
| `reasoning_content` arrives but no `content`                          | The generation cap may have been consumed by hidden reasoning. |
| `GET /api/v0/models` reports a large `loaded_context_length`          | LM Studio's loaded context is not the limiting factor.         |
| A direct streamed `/v1/chat/completions` request returns both fields  | The server's OpenAI-compatible streaming format is working.    |

LM Studio streams Qwen reasoning in `delta.reasoning_content` and its visible
answer in `delta.content`. pi-ai's OpenAI Completions adapter supports both;
the integration should not discard reasoning merely because it is not shown in
the transcript.

## Operational behavior

Local credentials are registered at server boot. Restart Staffroom after
upgrading this integration so existing credentials are re-registered with the
LM Studio model catalog. Asking Settings to list a local server's models also
refreshes that credential's registered catalog.

If LM Studio is unavailable during registration, Staffroom keeps the credential
registered but cannot create concrete model entries until a later catalog
refresh. Start/load the model in LM Studio, then use the credential's **models**
action (or restart Staffroom).
