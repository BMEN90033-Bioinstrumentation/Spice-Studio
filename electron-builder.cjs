// electron-builder config. JS (not yml) so signing follows the environment:
// real signing + notarisation only when credentials exist, otherwise an ad-hoc signed build that runs on this Mac.
const { existsSync } = require('node:fs')
const { execSync } = require('node:child_process')
const { Arch } = require('electron-builder')

// mac: CSC_LINK (+CSC_KEY_PASSWORD) / CSC_NAME, or a Developer ID identity already in the keychain
// (CSC_IDENTITY_AUTO_DISCOVERY=false ignores the keychain -> ad-hoc)
const keychainId = () => {
  try {
    return process.platform === 'darwin' && /Developer ID Application/.test(execSync('security find-identity -v -p codesigning', { encoding: 'utf8' }))
  } catch {
    return false
  }
}
const signed = !!(process.env.CSC_LINK || process.env.CSC_NAME) || (process.env.CSC_IDENTITY_AUTO_DISCOVERY !== 'false' && keychainId())
// MAC_ARCH=arm64 | x64 | arm64,x64 (default: this machine's arch; each arch needs its own vendor/ngspice/darwin-<arch>)
const macArch = (process.env.MAC_ARCH || process.arch).split(',')
// bundled ngspice: vendor/ngspice/<process.platform>-<arch> -> <resources>/ngspice. ${arch} is electron-builder's
// (x64/arm64, same as Node's); the platform part is spelled out per OS because ${platform} is the *host* platform.
const ngspice = (platform) => [{ from: `vendor/ngspice/${platform}-\${arch}`, to: 'ngspice', filter: ['**/*'] }]

module.exports = {
  appId: 'com.callumvidler.ngspicestudio',
  productName: 'ngspice Studio',
  directories: { output: 'dist', buildResources: 'build' },
  files: ['out/**', 'package.json', '!node_modules/**'], // Vite bundles the renderer deps; main/preload only use electron + node builtins
  asar: true,
  npmRebuild: false, // no native modules
  fileAssociations: [
    { ext: 'nsproj', name: 'ngspice Studio project', role: 'Editor' },
    { ext: 'nsch', name: 'ngspice Studio schematic', role: 'Editor' }
  ],
  beforePack: ({ electronPlatformName: p, arch }) => {
    const dir = `vendor/ngspice/${p}-${Arch[arch]}`
    if (!existsSync(`${dir}/bin/ngspice${p === 'win32' ? '.exe' : ''}`))
      throw new Error(`${dir}/bin is missing: build the bundled ngspice first (npm run ngspice:build, or scripts/build-ngspice-win.sh in MSYS2)`)
  },
  mac: {
    target: [{ target: 'dmg', arch: macArch }, { target: 'zip', arch: macArch }],
    category: 'public.app-category.developer-tools',
    artifactName: '${productName}-${version}-mac-${arch}.${ext}', // dmg + zip, both arches side by side
    extraResources: ngspice('darwin'),
    // osx-sign signs every Mach-O in the bundle, so bin/ngspice and lib/ngspice/*.cm get the same identity and entitlements.
    // Ad-hoc has no Team ID, so the hardened runtime's library validation would refuse ngspice's .cm code models: off then.
    identity: signed ? undefined : '-',
    hardenedRuntime: signed,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    notarize: signed ? undefined : false // undefined: notarise when APPLE_ID/APPLE_API_KEY/APPLE_KEYCHAIN_PROFILE env is set
  },
  win: { target: [{ target: 'nsis', arch: ['x64'] }], extraResources: ngspice('win32') },
  nsis: { artifactName: '${productName}-${version}-setup.${ext}' },
  linux: {
    target: [{ target: 'AppImage', arch: ['x64'] }, { target: 'deb', arch: ['x64'] }],
    category: 'Development',
    maintainer: 'Callum Vidler',
    extraResources: ngspice('linux')
  }
}
