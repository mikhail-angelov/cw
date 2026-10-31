import { copyFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

if (process.platform !== 'darwin') throw new Error('Setting the app icon requires macOS');
const app = 'dist/CW Wallet.app';
if (!existsSync(app)) throw new Error('Build the app first: npm run build');
copyFileSync('assets/AppIcon.icns', `${app}/Contents/Resources/AppIcon.icns`);
const plist = `${app}/Contents/Info.plist`;
const plistBuddy = (command, quiet = false) => spawnSync('/usr/libexec/PlistBuddy', ['-c', command, plist], { stdio: quiet ? 'ignore' : 'inherit' });
if (plistBuddy('Add :CFBundleIconFile string AppIcon.icns', true).status !== 0) plistBuddy('Set :CFBundleIconFile AppIcon.icns');
const signed = spawnSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
if (signed.status !== 0) throw new Error('codesign failed');
console.log('App icon set');
