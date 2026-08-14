/** Renderer navigation policy for the Electron desktop shell. */

/**
 * Decide whether a renderer navigation stays inside the active Harness origin.
 * @param target - requested navigation URL.
 * @param harnessOrigin - exact random loopback origin assigned at startup.
 * @returns true only for HTTP pages on the same origin.
 */
export function isHarnessNavigation(target: string, harnessOrigin: string): boolean {
  try {
    return new URL(target).origin === harnessOrigin
  } catch {
    return false
  }
}

/**
 * Normalize a URL that may be handed to the operating system browser.
 * @param target - untrusted renderer target.
 * @returns a normalized HTTP(S) URL, or undefined for every other protocol.
 */
export function externalHttpUrl(target: string): string | undefined {
  try {
    const parsed = new URL(target)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : undefined
  } catch {
    return undefined
  }
}
