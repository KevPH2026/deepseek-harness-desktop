/** Pure presentation model for image/video generation Tool calls. */

import type { ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'
import {
  generatedMediaFromText, generatedMediaMeta, type MediaArtifact,
} from '../types.ts'

/** Lifecycle state rendered by a media Tool card. */
export type MediaToolState = 'running' | 'ok' | 'error' | 'stopped'

/** Stable presentation data derived only from a logged call/result slice. */
export interface MediaToolModel {
  kind: MediaArtifact['kind']
  prompt: string
  state: MediaToolState
  artifact: MediaArtifact | undefined
  output: string
}

function expectedKind(toolName: string): MediaArtifact['kind'] {
  return toolName === 'generate_video' ? 'video' : 'image'
}

function argsRaw(block: ToolCallBlock): string {
  return ('kind' in block ? block.call?.argsRaw : block.argsRaw) ?? ''
}

function promptOf(raw: string, callId: string): string {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const prompt = (parsed as Record<string, unknown>).prompt
      if (typeof prompt === 'string' && prompt.trim() !== '') return prompt.trim()
    }
  } catch {
    // A partial or older call remains identifiable by its durable raw args.
  }
  return raw.trim() === '' ? callId : raw.trim()
}

function outputOf(block: ToolCallBlock): string {
  if (!('kind' in block)) return ''
  const parts: string[] = []
  for (const content of block.content) {
    if (content.type === 'text') parts.push(content.text)
    else parts.push(JSON.stringify(content, null, 2))
  }
  if (parts.length === 0 && block.error !== undefined) {
    parts.push(`${block.error.name}: ${block.error.code}`)
  }
  return parts.join('\n')
}

function belongsToTool(artifact: MediaArtifact, kind: MediaArtifact['kind']): boolean {
  if (artifact.kind !== kind) return false
  return kind === 'image' ? artifact.provider === 'openai-images' : artifact.provider === 'google-veo'
}

/**
 * Recover one same-origin artifact from direct presentation metadata or the
 * text marker used by nested Code dispatches.
 * @param block - running or settled Tool slice.
 * @param kind - media kind owned by the Tool name.
 * @returns a strictly validated artifact, or undefined.
 */
export function artifactFromToolBlock(
  block: ToolCallBlock,
  kind: MediaArtifact['kind'],
): MediaArtifact | undefined {
  if (!('kind' in block)) return undefined
  const direct = generatedMediaMeta(block.meta)
  if (direct !== undefined && belongsToTool(direct.artifact, kind)) return direct.artifact
  const marker = generatedMediaFromText(outputOf(block))
  return marker !== undefined && belongsToTool(marker.artifact, kind) ? marker.artifact : undefined
}

/**
 * Project a media Tool call into replay-stable card data.
 * @param toolName - `generate_image` or `generate_video` dispatch key.
 * @param block - running or settled Tool slice.
 * @returns card data derived only from durable arguments, content, and metadata.
 */
export function mediaToolModel(toolName: string, block: ToolCallBlock): MediaToolModel {
  const kind = expectedKind(toolName)
  const done = 'kind' in block
  const output = outputOf(block)
  const state: MediaToolState = !done
    ? 'running'
    : block.error?.code === 'interrupted' ? 'stopped'
      : block.isError ? 'error' : 'ok'
  return {
    kind,
    prompt: promptOf(argsRaw(block), block.callId),
    state,
    artifact: state === 'ok' ? artifactFromToolBlock(block, kind) : undefined,
    output,
  }
}

/**
 * Compact a byte count for artifact metadata.
 * @param bytes - positive safe integer from a validated artifact.
 * @returns compact binary-unit text.
 */
export function formatMediaBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
