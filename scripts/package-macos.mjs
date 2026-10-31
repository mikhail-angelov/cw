import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

if (process.platform !== 'darwin') throw new Error('macOS packaging requires macOS');
const { version } = JSON.parse(readFileSync('tinyjs.json', 'utf8'));
const name = `CW-Wallet-${version}-macos-universal.zip`;
const output = resolve('release');
mkdirSync(output, { recursive: true });
const archive = resolve(output, name);
const result = spawnSync('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', 'dist/CW Wallet.app', archive], { stdio: 'inherit' });
if (result.status !== 0) throw new Error('ditto failed');
const sha256 = createHash('sha256').update(readFileSync(archive)).digest('hex');
writeFileSync(`${archive}.sha256`, `${sha256}  ${name}\n`);
console.log(`Packaged ${name} (${sha256})`);
