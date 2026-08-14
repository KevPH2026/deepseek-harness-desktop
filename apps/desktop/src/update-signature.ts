/** Developer ID gate for the desktop auto-update channel. */

import { execFile } from 'node:child_process'
import { resolve } from 'node:path'

/** Why the GitHub Release updater is enabled or intentionally dormant. */
export type DesktopUpdateEligibility =
  | { enabled: true; reason: 'signed-release' }
  | { enabled: false; reason: 'development' | 'unsupported-platform' | 'signature-unverified' }

/** Injectable signature inspection used by focused tests. */
export type DeveloperIdProbe = (appBundle: string) => Promise<string | undefined>

/** Resolve the enclosing `.app` from Electron's `Contents/MacOS` executable. */
export function macAppBundlePath(executable: string): string {
  return resolve(executable, '../../..')
}

/**
 * Enable updates only for a packaged macOS app with a valid Developer ID
 * signature. Local/ad-hoc beta packages stay offline and fail soft.
 */
export async function desktopUpdateEligibility(
  isPackaged: boolean,
  platform: NodeJS.Platform,
  executable: string,
  probe: DeveloperIdProbe = probeDeveloperIdSignature,
): Promise<DesktopUpdateEligibility> {
  if (!isPackaged) return { enabled: false, reason: 'development' }
  if (platform !== 'darwin') return { enabled: false, reason: 'unsupported-platform' }

  const signature = await probe(macAppBundlePath(executable)).catch(() => undefined)
  if (
    signature === undefined
    || /^Signature=adhoc$/mu.test(signature)
    || !/^Authority=Developer ID Application:/mu.test(signature)
    || !/^TeamIdentifier=(?!not set$)[A-Z0-9]+$/mu.test(signature)
  ) return { enabled: false, reason: 'signature-unverified' }

  return { enabled: true, reason: 'signed-release' }
}

/** Verify the bundle, then return its signed identity description. */
async function probeDeveloperIdSignature(appBundle: string): Promise<string | undefined> {
  const verified = await codesign(['--verify', '--deep', '--strict', appBundle])
  if (!verified.ok) return undefined
  const described = await codesign(['--display', '--verbose=4', appBundle])
  return described.ok ? described.output : undefined
}

interface CodesignResult {
  ok: boolean
  output: string
}

function codesign(args: string[]): Promise<CodesignResult> {
  return new Promise((resolveResult) => {
    execFile('/usr/bin/codesign', args, { encoding: 'utf8' }, (error, stdout, stderr) => {
      resolveResult({ ok: error === null, output: `${stdout}${stderr}` })
    })
  })
}
