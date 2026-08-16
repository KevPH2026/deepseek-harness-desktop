# @deepseek-ai/dsh-channel

English | [中文](README.zh.md)

Provider-neutral Service Definition for authenticated text channels. A transport registers a `ChannelProvider`, then submits normalized text to `ctx.channel.admit()`. One product consumer owns admission, idempotency, and application behavior. Outbound text returns through `ctx.channel.deliver()` and the provider named by the message.

The transport authenticates senders and validates its wire input before admission. The service carries four explicit identifiers—provider, conversation, sender, and external message—without exposing transport credentials or a generic RPC surface. `admit()` settles only after the consumer's durable admission commit, so a polling provider may advance its external offset after `accepted` or `duplicate`.

## Model Experience

### Authenticated text carrier

#### What the model sees

Nothing directly from this package. The service passes normalized authenticated text and opaque transport identity through `ctx.channel.admit()` to the sole registered consumer, which decides whether any text enters an Agent request.

#### Token effect

Zero directly. A consumer may conditionally add admitted text to its own model request; duplicate admission and provider delivery do not create context here.

#### KV Cache effect

This package creates no model request and does not alter an existing reusable prefix. Session selection and cache behavior belong to the registered consumer.

## Known Limitations and Deferred Work

- The service carries text only. Media, edits, reactions, delivery retries, and provider-specific formatting remain provider or future capability work.
