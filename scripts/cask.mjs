import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const [version, directory = 'release'] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version || '')) throw new Error('Usage: node scripts/cask.mjs <version> [release directory]');
const archive = `CW-Wallet-${version}-macos-universal.zip`;
const sha256 = readFileSync(join(directory, `${archive}.sha256`), 'utf8').split(/\s+/)[0];
if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error('Invalid release checksum');
process.stdout.write(`cask "cw-wallet" do
  version "${version}"
  sha256 "${sha256}"

  url "https://github.com/mikhail-angelov/cw/releases/download/v#{version}/CW-Wallet-#{version}-macos-universal.zip"
  name "CW Wallet"
  desc "Local Ethereum and USDT wallet for macOS"
  homepage "https://github.com/mikhail-angelov/cw"

  app "CW Wallet.app"

  caveats <<~EOS
    This build is ad-hoc signed and not notarized. macOS may ask you to
    approve it in System Settings > Privacy & Security on first launch.
  EOS
end
`);
