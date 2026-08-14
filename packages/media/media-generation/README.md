# @deepseek-ai/dsh-media-generation

English | [中文](README.zh.md)

Opt-in image and video generation for DeepSeek Harness. The Host plugin dynamically registers `generate_image` and `generate_video` from the live `media-generation` settings section, resolves credential references immediately before each operation, and keeps one immutable configuration snapshot from approval through execution. Both tools are disabled by default, and the default `always` approval policy asks before any provider request that may incur charges.

Images use an OpenAI-compatible Images endpoint and require a canonical base64 response. Videos use Google Veo's long-running operation API and poll in the foreground until completion, cancellation, or the configured deadline. Generated image bytes pass through `ctx.attachments.validateImage`, including full raster decode and pixel limits, before publication. The artifact store then verifies the container, enforces its byte cap, writes owner-only content-addressed files below `<DSH_HOME>/media/v1`, and exposes GET, HEAD, and single-range reads at `/generated-media/<sha256>.<extension>` when `ctx.webServer` is present.

The browser half contributes a Media settings page and keyed Tool cards. Settings and credential status use the existing Host settings and credentials APIs; API keys are write-only and never enter the settings document. A successful tool call returns `{ artifact: MediaArtifact }`, stores the replay card payload in `presentationMeta`, and appends the same payload as a text marker so nested Code Mode calls remain renderable.

## Configuration

| Key | Default | Meaning |
|---|---:|---|
| `approval` | `always` | Ask for every generation; `video-only` asks only for video, and `never` starts both without confirmation. |
| `image.enabled` | `false` | Register `generate_image`. |
| `image.baseURL` | `https://api.openai.com/v1` | HTTPS Images API base; loopback HTTP is allowed for local providers. |
| `image.model` | `gpt-image-2` | Model id sent to the image provider. |
| `image.apiKeyEnv` | `OPENAI_API_KEY` | Credential reference resolved per operation. |
| `image.defaultSize` | `auto` | Default `auto`, `1024x1024`, `1536x1024`, or `1024x1536`. |
| `image.defaultQuality` | `auto` | Default `auto`, `low`, `medium`, or `high`. |
| `video.enabled` | `false` | Register `generate_video`. |
| `video.baseURL` | `https://generativelanguage.googleapis.com/v1beta` | Google generative-language API base. |
| `video.model` | `veo-3.1-generate-preview` | Veo model id. |
| `video.apiKeyEnv` | `GOOGLE_API_KEY` | Credential reference resolved per operation. |
| `video.defaultAspectRatio` | `16:9` | Default `16:9` or `9:16`. |
| `video.defaultDuration` | `4` | Default 4, 6, or 8 seconds. |
| `video.defaultResolution` | `720p` | Default `720p`, `1080p`, or `4k`; 1080p and 4k require 8 seconds. |
| `maxImageBytes` | `5242880` | Maximum retained image bytes; the attachment backend may impose an equal or stricter decoded-image policy. |
| `maxVideoBytes` | `536870912` | Maximum retained video bytes. |
| `videoPollIntervalMs` | `10000` | Delay between Veo operation reads. |
| `videoTimeoutMs` | `1200000` | Complete Veo operation deadline. |

Provider URLs reject embedded credentials, queries, fragments, non-HTTP schemes, and non-loopback cleartext endpoints. Image and video model ids must be non-empty; credential references use environment-variable syntax. Live settings changes add or remove the corresponding tool without a restart. Calls already admitted retain their approved endpoint, model, defaults, limits, and credential reference; the credential value itself is resolved immediately before the provider request.

## Model Experience

### System prompt

#### What the model sees

The section is absent while both tools are disabled. Otherwise `<enabled-tools>` is the enabled tool name or the two names joined by ` and `.

##### Conditional media guidance

```markdown
Use <enabled-tools> only when the user's requested deliverable genuinely needs a new image or video; do not call them merely to discuss or analyze media. Generate one artifact at a time by default. The result is already displayed in a media card, so do not repeat its internal URL. Provider calls may incur charges and require approval.
```

#### Token effect

Fixed conditional guidance while at least one tool is enabled.

#### KV Cache effect

Prefix-stable while enablement and plugin lifecycle are unchanged. Enabling or disabling either tool may invalidate reuse from this section and the changed tool-schema list.

### Tool schemas

#### What the model sees

The model sees the generated [`generate_image` and `generate_video` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-media-generation) only while the corresponding provider is enabled. Provider endpoints, model ids, credentials, byte limits, polling, deadlines, and approval policy remain deployment settings; calls may override only the documented media-format defaults.

#### Token effect

Fixed schema cost per enabled tool. Prompt text, optional format arguments, and retained results are data-dependent.

#### KV Cache effect

Prefix-stable while tool enablement and visibility are unchanged. Settings enablement, plugin lifecycle, or scoped tool restrictions may invalidate reuse from the first changed schema token.

### Generated result

#### What the model sees

A success renders `Generated <kind> with <model>.`, then `Open: <internal-url>`, then a `<dsh-media-artifact>` JSON marker containing the canonical artifact. Approval denial and provider, validation, size, cancellation, or timeout failures become ordinary error tool results and publish no new artifact.

#### Token effect

One short data-dependent result plus its artifact marker is retained and resent until compaction. Generated binary bytes never enter model context.

#### KV Cache effect

Append-only; a new call and result follow the reusable request prefix.

## Known Limitations and Deferred Work

- **Video generation occupies the foreground tool call** — it does not publish a background job and cannot resume an in-flight Veo operation after process restart. Cancelling, timing out, or quitting stops local polling and download, but a provider operation that was already submitted may continue remotely and may still incur charges.
- **Generated artifacts are retained indefinitely** — content addressing deduplicates identical bytes, but reference-aware garbage collection is deferred.
- **Artifact authorization is loopback-origin-wide** — the route accepts only a loopback Host and same-origin browser markers, requires an exact unguessable hash name, and sends same-origin/no-sniff headers, but it has no per-session access-control list.
- **Credential UI is write-only, not process isolation** — API keys never enter the settings document or browser response, but the current local credential provider and Agent tools run as the same operating-system user. Use restricted, low-limit provider keys and do not treat the credential file as hidden from an untrusted shell process.
- **Provider retries are manual** — generation requests have no automatic retry or cross-restart idempotency key. Inspect a failed or interrupted request before retrying so a second paid generation is not started unintentionally.
- **Provider response support is intentionally narrow** — image providers must return canonical `b64_json`; URL-only image results are rejected, and Veo cross-origin downloads are limited to approved Google media hosts.
