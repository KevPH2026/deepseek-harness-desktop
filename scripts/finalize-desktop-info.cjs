const { execFileSync } = require('node:child_process')
const { join } = require('node:path')

/**
 * Tighten and validate the final macOS bundle metadata after electron-builder
 * adds its updater-oriented localhost defaults. afterPack runs before signing.
 *
 * @param {import('electron-builder').AfterPackContext} context
 */
exports.afterPack = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return

  const appName = context.packager.appInfo.productFilename
  const infoPlist = join(context.appOutDir, `${appName}.app`, 'Contents', 'Info.plist')
  const atsKey = 'NSAppTransportSecurity'
  const packageVersion = context.packager.appInfo.version
  const expectedShortVersion = packageVersion.split('-', 1)[0].split('+', 1)[0]
  const configuredShortVersion = context.packager.platformSpecificBuildOptions.bundleShortVersion
  const configuredBundleVersion = context.packager.platformSpecificBuildOptions.bundleVersion

  if (configuredShortVersion !== expectedShortVersion) {
    throw new Error(
      `finalize-desktop-info: mac.bundleShortVersion ${String(configuredShortVersion)} `
      + `must equal package SemVer core ${expectedShortVersion}.`,
    )
  }
  if (!isAppleNumericVersion(configuredShortVersion, 3, 3)) {
    throw new Error(`finalize-desktop-info: invalid CFBundleShortVersionString ${String(configuredShortVersion)}.`)
  }
  if (!isAppleNumericVersion(configuredBundleVersion, 1, 3)) {
    throw new Error(`finalize-desktop-info: invalid CFBundleVersion ${String(configuredBundleVersion)}.`)
  }

  execFileSync('/usr/bin/plutil', [
    '-replace', `${atsKey}.NSAllowsArbitraryLoads`, '-bool', 'false', infoPlist,
  ])
  execFileSync('/usr/bin/plutil', [
    '-replace', `${atsKey}.NSAllowsLocalNetworking`, '-bool', 'true', infoPlist,
  ])

  const ats = JSON.parse(execFileSync('/usr/bin/plutil', [
    '-extract', atsKey, 'json', '-o', '-', infoPlist,
  ], { encoding: 'utf8' }))
  const exceptionDomains = ats.NSExceptionDomains
  if (
    ats.NSAllowsArbitraryLoads !== false
    || ats.NSAllowsLocalNetworking !== true
    || exceptionDomains?.localhost === undefined
    || exceptionDomains?.['127.0.0.1'] === undefined
  ) {
    throw new Error(`finalize-desktop-info: invalid final ATS dictionary: ${JSON.stringify(ats)}`)
  }

  const finalShortVersion = plistString(infoPlist, 'CFBundleShortVersionString')
  const finalBundleVersion = plistString(infoPlist, 'CFBundleVersion')
  if (finalShortVersion !== configuredShortVersion || finalBundleVersion !== configuredBundleVersion) {
    throw new Error(
      'finalize-desktop-info: electron-builder emitted unexpected bundle versions: '
      + `${finalShortVersion} (${finalBundleVersion}).`,
    )
  }

  console.log(
    'finalize-desktop-info: ATS restricted to local networking; '
    + `bundle versions ${finalShortVersion} (${finalBundleVersion}); updater SemVer ${packageVersion}.`,
  )
}

function plistString(infoPlist, key) {
  return execFileSync('/usr/bin/plutil', [
    '-extract', key, 'raw', '-o', '-', infoPlist,
  ], { encoding: 'utf8' }).trim()
}

function isAppleNumericVersion(value, minimumComponents, maximumComponents) {
  if (typeof value !== 'string') return false
  const components = value.split('.')
  return components.length >= minimumComponents
    && components.length <= maximumComponents
    && components.every(component => /^(?:0|[1-9]\d*)$/.test(component))
}
