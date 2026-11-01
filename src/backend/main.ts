import { createPublicClient, createWalletClient, encodeFunctionData, formatEther, formatUnits, getAddress, hexToBytes, http, isAddress, keccak256, parseAbi, parseUnits, toHex, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { mainnet } from 'viem/chains';
import { scryptAsync } from '@noble/hashes/scrypt.js';
import { TronWeb } from 'tronweb';

const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const TOKENS = { USDT, USDC } as const;
type TokenSymbol = keyof typeof TOKENS;
const ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function transfer(address,uint256) returns (bool)',
  'event Transfer(address indexed from,address indexed to,uint256 value)',
]);
const QUOTER = '0x61fFE014bA17989E743c5F6cB21bF9697530B21e';
const ROUTER = '0xE592427A0AEce92De3Edee1F18E0157C05861564';
const QUOTER_ABI = parseAbi(['function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) view returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)']);
const ROUTER_ABI = parseAbi(['function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)']);
const INFURA = 'infura-api-key';
const WALLETS = 'wallets-v2';
const ACTIVE = 'active-wallet-v2';
const CONTACTS = 'counterparties';
const PAYMENTS = 'payments';
const TRON_USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const tronOverviewName = (who: string) => `tron-overview-v1:${who.toLowerCase()}`;
let sending = false;
let pendingSwap: { id: string; sender: Hex; tokenIn: TokenSymbol; amountIn: bigint; quotedOut: bigint; fee: number; createdAt: number } | null = null;

type Vault = { version: 1; address: Hex; salt: Hex; iv: Hex; ciphertext: Hex };
type WalletEntry = { address: Hex; label: string };
type Counterparty = { name: string; address: Hex; description: string; createdAt: string; lastPaymentAt: string | null };

const vaultName = (who: string) => `wallet-vault-v2:${who.toLowerCase()}`;
const overviewName = (who: string) => `overview-v2:${who.toLowerCase()}`;

async function walletList(app: any): Promise<WalletEntry[]> {
  const saved = await app.store.get(WALLETS);
  return Array.isArray(saved) ? saved.filter((item) => isAddress(item?.address)) : [];
}

async function activeWallet(app: any): Promise<WalletEntry | null> {
  const wallets = await walletList(app);
  const selected = await app.store.get(ACTIVE);
  return wallets.find((item) => item.address.toLowerCase() === selected?.toLowerCase()) ?? wallets[0] ?? null;
}

async function addWallet(app: any, who: Hex, label = '') {
  const wallets = await walletList(app);
  const existing = wallets.find((item) => item.address.toLowerCase() === who.toLowerCase());
  const next = existing ? wallets.map((item) => item === existing ? { ...item, label: label || item.label } : item) : [...wallets, { address: who, label }];
  if (!(await app.store.set(WALLETS, next)) || !(await app.store.set(ACTIVE, who))) throw new Error('Could not save wallet.');
  return next.find((item) => item.address.toLowerCase() === who.toLowerCase())!;
}

async function saveSigningKey(app: any, who: Hex, vault: string) {
  const secret = vaultName(who);
  await app.secrets.set(secret, vault);
  try { await addWallet(app, who); await markVault(app, who, true); }
  catch (error) { await app.secrets.delete(secret); throw error; }
}

// Key presence is mirrored in the plain store so app startup never touches
// Keychain and never triggers its access prompts. The secret itself is read
// only when signing: payments, swaps and key export.
const KEY_FLAGS = 'key-flags-v1';
type KeyFlags = { vaults: Record<string, boolean>; infuraPresent: boolean };
async function readKeyFlags(app: any): Promise<KeyFlags> {
  const saved = await app.store.get(KEY_FLAGS);
  return saved && typeof saved === 'object' && typeof saved.vaults === 'object'
    ? { vaults: saved.vaults, infuraPresent: !!saved.infuraPresent }
    : { vaults: {}, infuraPresent: false };
}
async function writeKeyFlags(app: any, flags: KeyFlags) { await app.store.set(KEY_FLAGS, flags); }
async function markVault(app: any, who: string | null | undefined, present: boolean) {
  if (!who) return;
  const flags = await readKeyFlags(app);
  const id = who.toLowerCase();
  flags.vaults[id] = present;
  await writeKeyFlags(app, flags);
}
async function markInfura(app: any, present: boolean) {
  const flags = await readKeyFlags(app);
  flags.infuraPresent = present;
  await writeKeyFlags(app, flags);
}

function paymentPassword(value: unknown): string {
  if (typeof value !== 'string' || value.length < 12 || value.length > 256) throw new Error('Пароль платежа должен содержать от 12 до 256 символов.');
  return value;
}

async function encryptKey(key: Hex, password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const derived = await scryptAsync(new TextEncoder().encode(password), salt, { N: 1 << 16, r: 8, p: 2, dkLen: 32 });
  const aes = await crypto.subtle.importKey('raw', Uint8Array.from(derived).buffer, 'AES-GCM', false, ['encrypt']);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: Uint8Array.from(iv).buffer }, aes, new TextEncoder().encode(key));
  return JSON.stringify({ version: 1, address: privateKeyToAccount(key).address, salt: toHex(salt), iv: toHex(iv), ciphertext: toHex(new Uint8Array(ciphertext)) });
}

function parseVault(value: string): Vault {
  let data: Vault;
  try { data = JSON.parse(value); } catch { throw new Error('Хранилище ключа повреждено.'); }
  if (!data || data.version !== 1 || !isAddress(data.address) || !/^0x[0-9a-fA-F]{32}$/.test(data.salt) || !/^0x[0-9a-fA-F]{24}$/.test(data.iv) || !/^0x[0-9a-fA-F]+$/.test(data.ciphertext))
    throw new Error('Хранилище ключа повреждено.');
  return data;
}

async function decryptKey(vault: Vault, password: string): Promise<Hex> {
  try {
    const derived = await scryptAsync(new TextEncoder().encode(password), hexToBytes(vault.salt), { N: 1 << 16, r: 8, p: 2, dkLen: 32 });
    const aes = await crypto.subtle.importKey('raw', Uint8Array.from(derived).buffer, 'AES-GCM', false, ['decrypt']);
    const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Uint8Array.from(hexToBytes(vault.iv)).buffer }, aes, Uint8Array.from(hexToBytes(vault.ciphertext)).buffer);
    const key = new TextDecoder('utf-8', { fatal: true }).decode(raw) as Hex;
    if (!/^0x[0-9a-fA-F]{64}$/.test(key) || privateKeyToAccount(key).address.toLowerCase() !== vault.address.toLowerCase()) throw new Error('invalid key');
    return key;
  } catch { throw new Error('Неверный пароль платежа или повреждённый ключ.'); }
}

async function readContacts(app: any): Promise<Counterparty[]> {
  const saved = await app.store.get(CONTACTS);
  return Array.isArray(saved) ? saved : [];
}

async function readPayments(app: any) {
  const saved = await app.store.get(PAYMENTS);
  return Array.isArray(saved) ? saved : [];
}

async function ensureNonceAvailable(app: any, sender: Hex, nonce: number) {
  const payments = await readPayments(app);
  if (payments.some((item) => item.status === 'pending' && item.sender?.toLowerCase() === sender.toLowerCase() && Number.isInteger(item.nonce) && item.nonce >= nonce))
    throw new Error('A previous transaction has an unknown status. Check its hash before sending another transaction.');
}

async function refreshPendingPayments(app: any) {
  const payments = await readPayments(app);
  if (!payments.some((item) => item.status === 'pending')) return payments;
  let publicClient: Awaited<ReturnType<typeof clients>>['publicClient'];
  try { publicClient = (await clients(app)).publicClient; }
  catch { return payments; }
  const contacts = await readContacts(app);
  let changed = false;
  for (const payment of payments.filter((item) => item.status === 'pending').slice(0, 20)) {
    try {
      const receipt = await publicClient.getTransactionReceipt({ hash: hash(payment.hash) });
      const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
      payment.status = receipt.status === 'success' ? 'confirmed' : 'failed';
      payment.date = new Date(Number(block.timestamp) * 1000).toISOString();
      if (payment.status === 'confirmed' && payment.kind !== 'swap') {
        const contact = contacts.find((item) => item.address.toLowerCase() === payment.recipient.toLowerCase());
        if (contact && (!contact.lastPaymentAt || contact.lastPaymentAt < payment.date)) contact.lastPaymentAt = payment.date;
      }
      changed = true;
    } catch { /* Still pending, or the RPC is temporarily unavailable. */ }
  }
  if (changed) {
    await app.store.set(PAYMENTS, payments);
    await app.store.set(CONTACTS, contacts);
  }
  return payments;
}

function address(value: unknown) {
  if (typeof value !== 'string' || !isAddress(value)) throw new Error('Некорректный Ethereum-адрес.');
  return getAddress(value);
}
const tronAddress = (who: Hex) => TronWeb.address.fromHex(`41${who.slice(2)}`);
function hash(value: unknown) {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error('Некорректный хеш транзакции.');
  return value as `0x${string}`;
}
function amount(value: unknown) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value) || parseUnits(value, 6) <= 0n)
    throw new Error('Укажите положительную сумму USDT, не более 6 знаков после точки.');
  return value;
}
function tokenSymbol(value: unknown): TokenSymbol {
  if (value !== 'USDT' && value !== 'USDC') throw new Error('Unsupported token.');
  return value;
}
async function clients(app: any) {
  const flags = await readKeyFlags(app);
  const key = flags.infuraPresent ? await app.secrets.get(INFURA) : null;
  const url = key ? `https://mainnet.infura.io/v3/${key}` : 'https://ethereum-rpc.publicnode.com';
  const publicClient = createPublicClient({ chain: mainnet, transport: http(url) });
  try {
    if (await publicClient.getChainId() !== 1) throw new Error('wrong network');
  } catch {
    throw new Error('Не удалось подключиться к Ethereum mainnet. Проверьте сеть или настройте личный Infura Project ID.');
  }
  return { publicClient, url };
}
async function savedVault(app: any, who: Hex): Promise<Vault> {
  const value = await app.secrets.get(vaultName(who));
  try { await markVault(app, who, !!value); } catch { /* Flag updates must never break signing. */ }
  if (!value) throw new Error('Сначала добавьте ключ и пароль платежа.');
  return parseVault(value);
}
async function network<T>(step: () => Promise<T>): Promise<T> {
  try { return await step(); }
  catch { throw new Error('Запрос к Ethereum не выполнен. Проверьте соединение и повторите.'); }
}

async function swapQuote(client: ReturnType<typeof createPublicClient>, tokenIn: TokenSymbol, amountIn: bigint, fee: number) {
  return client.readContract({ address: QUOTER, abi: QUOTER_ABI, functionName: 'quoteExactInputSingle', args: [{ tokenIn: TOKENS[tokenIn], tokenOut: TOKENS[tokenIn === 'USDT' ? 'USDC' : 'USDT'], amountIn, fee, sqrtPriceLimitX96: 0n }] });
}
async function tronBalances(who: Hex) {
  const tron = tronAddress(who);
  const response = await fetch(`https://api.trongrid.io/v1/accounts/${tron}`);
  if (!response.ok) throw new Error('TRON balance is temporarily unavailable.');
  const result = await response.json();
  if (!result.success || !Array.isArray(result.data)) throw new Error('TRON balance is temporarily unavailable.');
  const account = result.data[0];
  const tokenEntry = account?.trc20?.flatMap((entry: Record<string, string>) => Object.entries(entry)).find(([contract]: [string, string]) => contract === TRON_USDT);
  return { address: tron, activated: !!account, trx: BigInt(account?.balance ?? 0), usdt: BigInt(tokenEntry?.[1] ?? 0) };
}
export function onNavigate(info: { kind: string }) {
  if (info.kind === 'policy') return 'deny';
}

export const api = {
  async inspectTron({ walletAddress }: { walletAddress: unknown }, app: any) {
    const who = address(walletAddress);
    const balances = await tronBalances(who);
    const overview = { address: balances.address, activated: balances.activated, trx: formatUnits(balances.trx, 6), usdt: formatUnits(balances.usdt, 6), fetchedAt: new Date().toISOString() };
    await app.store.set(tronOverviewName(who), overview);
    return overview;
  },
  async saveWatchAddress({ walletAddress, label }: { walletAddress: unknown; label?: unknown }, app: any) {
    const who = address(walletAddress);
    if (label !== undefined && (typeof label !== 'string' || label.length > 50)) throw new Error('Wallet name must be at most 50 characters.');
    return addWallet(app, who, typeof label === 'string' ? label.trim() : '');
  },
  async selectWallet({ walletAddress }: { walletAddress: unknown }, app: any) {
    const who = address(walletAddress);
    const wallets = await walletList(app);
    if (!wallets.some((item) => item.address.toLowerCase() === who.toLowerCase())) throw new Error('Wallet is not in the list.');
    if (!(await app.store.set(ACTIVE, who))) throw new Error('Could not select wallet.');
    return true;
  },
  async removeWallet({ walletAddress }: { walletAddress: unknown }, app: any) {
    const who = address(walletAddress);
    const wallets = await walletList(app);
    if (!wallets.some((item) => item.address.toLowerCase() === who.toLowerCase())) throw new Error('Wallet is not in the list.');
    if (await app.secrets.get(vaultName(who))) throw new Error('Remove the signing key before removing this wallet.');
    const remaining = wallets.filter((item) => item.address.toLowerCase() !== who.toLowerCase());
    if (!(await app.store.set(WALLETS, remaining))) throw new Error('Could not remove wallet.');
    if ((await app.store.get(ACTIVE))?.toLowerCase() === who.toLowerCase()) await app.store.set(ACTIVE, remaining[0]?.address ?? null);
    return true;
  },
  async inspectAddress({ walletAddress }: { walletAddress: unknown }, app: any) {
    const who = address(walletAddress);
    const base = 'https://eth.blockscout.com/api';
    const rpc = createPublicClient({ chain: mainnet, transport: http('https://ethereum-rpc.publicnode.com') });
    const rpcReady = rpc.getChainId().then((id) => {
      if (id !== 1) throw new Error('Wrong Ethereum network.');
    });
    const request = async (params: Record<string, string>) => {
      const query = new URLSearchParams({ module: 'account', address: who, ...params });
      const response = await fetch(`${base}?${query}`);
      if (!response.ok) throw new Error('Blockscout недоступен.');
      const data = await response.json();
      if (data.status !== '1') {
        if (params.action === 'tokentx' && Array.isArray(data.result) && data.result.length === 0) return [];
        throw new Error('Blockscout не вернул данные по адресу.');
      }
      return data.result;
    };
    const [ethResult, usdtResult, usdcResult] = await Promise.allSettled([
      rpcReady.then(() => rpc.getBalance({ address: who })).catch(async () => BigInt(await request({ action: 'balance' }))),
      rpcReady.then(() => rpc.readContract({ address: USDT, abi: ABI, functionName: 'balanceOf', args: [who] })).catch(async () => BigInt(await request({ action: 'tokenbalance', contractaddress: USDT }))),
      rpcReady.then(() => rpc.readContract({ address: USDC, abi: ABI, functionName: 'balanceOf', args: [who] })).catch(async () => BigInt(await request({ action: 'tokenbalance', contractaddress: USDC }))),
    ]);
    if (ethResult.status === 'rejected' && usdtResult.status === 'rejected' && usdcResult.status === 'rejected')
      throw new Error('Balance is temporarily unavailable. Try refreshing later.');
    const eth = ethResult.status === 'fulfilled' ? ethResult.value : null;
    const usdt = usdtResult.status === 'fulfilled' ? usdtResult.value : null;
    const usdc = usdcResult.status === 'fulfilled' ? usdcResult.value : null;
    const saved = await app.store.get(overviewName(who));
    const previous = saved?.address?.toLowerCase() === who.toLowerCase() ? saved : null;
    const overview = {
      address: who,
      eth: eth === null ? previous?.eth ?? null : formatEther(eth),
      usdt: usdt === null ? previous?.usdt ?? null : formatUnits(usdt, 6),
      usdc: usdc === null ? previous?.usdc ?? null : formatUnits(usdc, 6),
      staleFields: [eth === null && 'ETH', usdt === null && 'USDT', usdc === null && 'USDC'].filter(Boolean),
      fetchedAt: new Date().toISOString(),
    };
    await app.store.set(overviewName(who), overview);
    return overview;
  },
  async loadTransferHistory({ walletAddress }: { walletAddress: unknown }) {
    const who = address(walletAddress);
    const request = async (symbol: TokenSymbol) => {
      const query = new URLSearchParams({ module: 'account', address: who, action: 'tokentx', contractaddress: TOKENS[symbol], page: '1', offset: '50', sort: 'desc' });
      const response = await fetch(`https://eth.blockscout.com/api?${query}`);
      if (!response.ok) throw new Error('History request failed.');
      const data = await response.json();
      if (data.status !== '1' && !Array.isArray(data.result)) throw new Error('History request failed.');
      return (Array.isArray(data.result) ? data.result : []).filter((item: any) => item.contractAddress?.toLowerCase() === TOKENS[symbol].toLowerCase() && BigInt(item.value) > 0n)
        .map((item: any) => ({ hash: hash(item.hash), from: address(item.from), to: address(item.to), value: formatUnits(BigInt(item.value), 6), token: symbol, date: new Date(Number(item.timeStamp) * 1000).toISOString() }));
    };
    const results = await Promise.allSettled([request('USDT'), request('USDC')]);
    if (results.every((result) => result.status === 'rejected')) throw new Error('Transaction history is temporarily unavailable.');
    return { transfers: results.flatMap((result) => result.status === 'fulfilled' ? result.value : []).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20), unavailable: results.map((result, index) => result.status === 'rejected' ? (index === 0 ? 'USDT' : 'USDC') : null).filter(Boolean) };
  },
  async walletState(_: unknown, app: any) {
    const wallets = await walletList(app);
    const active = await activeWallet(app);
    const activeAddress = active?.address ?? null;
    const savedOverview = activeAddress ? await app.store.get(overviewName(activeAddress)) : null;
    const cachedOverview = savedOverview;
    const cachedTron = activeAddress ? await app.store.get(tronOverviewName(activeAddress)) : null;
    // Startup never reads Keychain: presence flags live in the plain store
    // and are learned when a secret is actually used (see savedVault and the
    // key setup actions). An unknown address is reported optimistically so an
    // existing install keeps working right after the update.
    const flags = await readKeyFlags(app);
    const knownVault = activeAddress ? flags.vaults[activeAddress.toLowerCase()] : undefined;
    const hasVault = knownVault === undefined ? true : !!knownVault;
    return { wallets, activeAddress, cachedOverview, cachedTron, tronAddress: activeAddress ? tronAddress(activeAddress) : null, signerAddress: hasVault ? activeAddress : null, hasInfuraKey: flags.infuraPresent, hasPaymentPassword: hasVault, keychainAvailable: true };
  },
  async listCounterparties(_: unknown, app: any) {
    return (await readContacts(app)).sort((a, b) => (b.lastPaymentAt ?? b.createdAt).localeCompare(a.lastPaymentAt ?? a.createdAt));
  },
  async saveCounterparty({ name, recipient, description }: { name: unknown; recipient: unknown; description: unknown }, app: any) {
    const to = address(recipient);
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 80) throw new Error('Укажите имя контрагента до 80 символов.');
    if (typeof description !== 'string' || description.length > 300) throw new Error('Описание должно быть короче 300 символов.');
    const contacts = await readContacts(app);
    const previous = contacts.find((contact) => contact.address.toLowerCase() === to.toLowerCase());
    const next: Counterparty = { name: name.trim().replace(/\s+/g, ' '), address: to, description: description.trim(), createdAt: previous?.createdAt ?? new Date().toISOString(), lastPaymentAt: previous?.lastPaymentAt ?? null };
    const updated = [...contacts.filter((contact) => contact.address.toLowerCase() !== to.toLowerCase()), next];
    if (!(await app.store.set(CONTACTS, updated))) throw new Error('Не удалось сохранить контрагента.');
    return next;
  },
  async deleteCounterparty({ recipient }: { recipient: unknown }, app: any) {
    const to = address(recipient);
    const contacts = await readContacts(app);
    if (!(await app.store.set(CONTACTS, contacts.filter((contact) => contact.address.toLowerCase() !== to.toLowerCase())))) throw new Error('Не удалось удалить контрагента.');
    return true;
  },
  async listPayments({ walletAddress }: { walletAddress: unknown }, app: any) {
    const who = address(walletAddress);
    return (await refreshPendingPayments(app)).filter((item) => item.sender?.toLowerCase() === who.toLowerCase()).slice(0, 20);
  },
  async saveInfuraKey({ key }: { key: unknown }, app: any) {
    if (typeof key !== 'string' || !/^[a-zA-Z0-9_-]{16,128}$/.test(key.trim())) throw new Error('Некорректный ключ Infura.');
    await app.secrets.set(INFURA, key.trim());
    await markInfura(app, true);
    return true;
  },
  async importWallet({ privateKey, password }: { privateKey: unknown; password: unknown }, app: any) {
    if (typeof privateKey !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(privateKey.trim())) throw new Error('Некорректный приватный ключ.');
    const chosen = paymentPassword(password);
    const key = privateKey.trim() as `0x${string}`;
    const account = privateKeyToAccount(key);
    const selected = await activeWallet(app);
    if (selected && selected.address.toLowerCase() !== account.address.toLowerCase()) throw new Error('This key belongs to another address. Select that wallet first.');
    if (await app.secrets.get(vaultName(account.address))) throw new Error('This wallet already has a signing key.');
    const vault = await encryptKey(key, chosen);
    await saveSigningKey(app, account.address, vault);
    return { address: account.address };
  },
  async importCwgKey({ encryptedKey, password, newPassword }: { encryptedKey: unknown; password: unknown; newPassword: unknown }, app: any) {
    const chosen = paymentPassword(newPassword);
    if (typeof encryptedKey !== 'string' || typeof password !== 'string' || !password) throw new Error('Укажите зашифрованный ключ и пароль cwg.');
    const parts = encryptedKey.trim().split(':');
    if (parts.length !== 4 || !/^[0-9a-fA-F]{32}$/.test(parts[0]) || !/^[0-9a-fA-F]{24}$/.test(parts[1]) || parts[2] !== '10' || !/^[0-9a-fA-F]{160}(?:[0-9a-fA-F]{4})?$/.test(parts[3]))
      throw new Error('Неверный формат ключа cwg.');
    let key: Hex;
    try {
      const derived = await scryptAsync(new TextEncoder().encode(password), hexToBytes(('0x' + parts[0]) as Hex), { N: 1 << 15, r: 8, p: 1, dkLen: 32 });
      const aesKey = Uint8Array.from(derived).buffer;
      const aes = await crypto.subtle.importKey('raw', aesKey, 'AES-GCM', false, ['decrypt']);
      const iv = Uint8Array.from(hexToBytes(('0x' + parts[1]) as Hex)).buffer;
      const ciphertext = Uint8Array.from(hexToBytes(('0x' + parts[3]) as Hex)).buffer;
      const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aes, ciphertext);
      const text = new TextDecoder('utf-8', { fatal: true }).decode(raw).trim();
      if (!/^(?:0x)?[0-9a-fA-F]{64}$/.test(text)) throw new Error('invalid decrypted key');
      key = ('0x' + text.replace(/^0x/, '')) as Hex;
    } catch {
      throw new Error('Не удалось расшифровать ключ cwg: проверьте пароль и данные.');
    }
    const account = privateKeyToAccount(key);
    const selected = await activeWallet(app);
    if (selected && selected.address.toLowerCase() !== account.address.toLowerCase()) throw new Error('This key belongs to another address. Select that wallet first.');
    if (await app.secrets.get(vaultName(account.address))) throw new Error('This wallet already has a signing key.');
    const vault = await encryptKey(key, chosen);
    await saveSigningKey(app, account.address, vault);
    return { address: account.address };
  },
  async createWallet({ password }: { password: unknown }, app: any) {
    const chosen = paymentPassword(password);
    const key = generatePrivateKey();
    const account = privateKeyToAccount(key);
    const vault = await encryptKey(key, chosen);
    await saveSigningKey(app, account.address, vault);
    return { address: account.address, backupKey: key };
  },
  async copyWalletAddress({ walletAddress }: { walletAddress: unknown }, app: any) {
    const who = address(walletAddress);
    if (!(await walletList(app)).some((item) => item.address.toLowerCase() === who.toLowerCase())) throw new Error('Wallet is not in the list.');
    if (!(await app.clipboard.write({ text: who }))) throw new Error('Could not copy the address.');
    return true;
  },
  async copyTronAddress({ walletAddress }: { walletAddress: unknown }, app: any) {
    const who = address(walletAddress);
    if (!(await walletList(app)).some((item) => item.address.toLowerCase() === who.toLowerCase())) throw new Error('Wallet is not in the list.');
    if (!(await app.clipboard.write({ text: tronAddress(who) }))) throw new Error('Could not copy the TRON address.');
    return true;
  },
  async copyPrivateKey({ walletAddress, password, locale }: { walletAddress: unknown; password: unknown; locale?: unknown }, app: any) {
    const who = address(walletAddress);
    if ((await activeWallet(app))?.address.toLowerCase() !== who.toLowerCase()) throw new Error('Selected wallet changed.');
    const key = await decryptKey(await savedVault(app, who), paymentPassword(password));
    if (!(await app.authenticate('copy the private key from CW Wallet'))) throw new Error('Authentication cancelled.');
    const english = locale === 'en';
    const confirmed = await app.dialog.confirm(english ? 'Copy the private key?' : 'Скопировать приватный ключ?', {
      detail: english ? 'Anyone with this key can spend all funds. Clipboard managers and Universal Clipboard may retain copies. The app will clear its clipboard entry after 30 seconds if it is unchanged.' : 'Любой, у кого есть этот ключ, может потратить все средства. Менеджеры буфера и Универсальный буфер могут сохранить копию. Приложение очистит свою запись через 30 секунд, если буфер не изменится.',
      ok: english ? 'Copy key' : 'Скопировать ключ', cancel: english ? 'Cancel' : 'Отмена',
    });
    if (!confirmed) return { cancelled: true };
    if ((await activeWallet(app))?.address.toLowerCase() !== who.toLowerCase()) throw new Error('Selected wallet changed.');
    if (!(await app.clipboard.write({ text: key }))) throw new Error('Could not copy the key.');
    try {
      const change = await app.clipboard.changeCount();
      setTimeout(async () => {
        try { if (await app.clipboard.changeCount() === change) await app.clipboard.write({ text: '' }); }
        catch { /* The app may have closed before cleanup. */ }
      }, 30_000);
    } catch { /* Clipboard copy already succeeded. */ }
    return true;
  },
  async deleteWallet({ locale }: { locale?: unknown }, app: any) {
    if (sending) throw new Error('Дождитесь завершения отправки.');
    if (!(await app.authenticate('remove the wallet from CW Wallet'))) throw new Error('Аутентификация отменена.');
    const selected = await activeWallet(app);
    if (!selected) throw new Error('Select a wallet first.');
    const stored = await app.secrets.get(vaultName(selected.address));
    if (!stored) throw new Error('Ключ не найден.');
    const english = locale === 'en';
    const confirmed = await app.dialog.confirm(english ? 'Remove this signing key?' : 'Удалить ключ подписи?', {
      detail: english ? `${selected.address}\nMake sure you have a backup of the private key. This cannot be undone.` : `${selected.address}\nУбедитесь, что у вас есть резервная копия приватного ключа. Это действие не отменить.`,
      ok: english ? 'Remove' : 'Удалить', cancel: english ? 'Cancel' : 'Отмена',
    });
    if (!confirmed) return false;
    if (!(await app.secrets.delete(vaultName(selected.address)))) throw new Error('Could not remove the key from Keychain.');
    await markVault(app, selected.address, false);
    return true;
  },
  async transactionStatus({ txHash }: { txHash: unknown }, app: any) {
    const transactionHash = hash(txHash);
    const { publicClient } = await clients(app);
    try {
      const receipt = await publicClient.getTransactionReceipt({ hash: transactionHash });
      await refreshPendingPayments(app);
      return { status: receipt.status === 'success' ? 'Успешно' : 'Ошибка', block: Number(receipt.blockNumber), gasUsed: receipt.gasUsed.toString() };
    } catch (error: any) {
      if (error?.name === 'TransactionReceiptNotFoundError') return { status: 'Ожидает подтверждения или не найдена' };
      throw new Error('Не удалось проверить статус транзакции.');
    }
  },
  async quoteSwap({ walletAddress, tokenIn, value }: { walletAddress: unknown; tokenIn: unknown; value: unknown }, app: any) {
    if (sending) throw new Error('Another transaction is already being sent.');
    const who = address(walletAddress);
    if ((await activeWallet(app))?.address.toLowerCase() !== who.toLowerCase()) throw new Error('Selected wallet changed.');
    const input = tokenSymbol(tokenIn);
    const humanAmount = amount(value);
    const amountIn = parseUnits(humanAmount, 6);
    const client = createPublicClient({ chain: mainnet, transport: http('https://ethereum-rpc.publicnode.com') });
    if (await client.getChainId() !== 1) throw new Error('Wrong Ethereum network.');
    const balance = await client.readContract({ address: TOKENS[input], abi: ABI, functionName: 'balanceOf', args: [who] });
    if (balance < amountIn) throw new Error(`Not enough ${input}.`);
    const fees = [100, 500, 3000];
    const results = await Promise.allSettled(fees.map((fee) => swapQuote(client, input, amountIn, fee)));
    const available = results.flatMap((result, index) => result.status === 'fulfilled' ? [{ fee: fees[index], output: result.value[0], gasEstimate: result.value[3] }] : []);
    available.sort((a, b) => a.output === b.output ? 0 : a.output > b.output ? -1 : 1);
    const best = available[0];
    if (!best || best.output === 0n) throw new Error('No USDT/USDC swap route is available.');
    if (best.output < amountIn * 95n / 100n) throw new Error('The quoted exchange rate is more than 5% below 1:1; swap blocked.');
    const minOut = best.output * 995n / 1000n;
    if (minOut === 0n) throw new Error('Amount is too small to protect with a minimum received amount.');
    const id = toHex(crypto.getRandomValues(new Uint8Array(16)));
    pendingSwap = { id, sender: who, tokenIn: input, amountIn, quotedOut: best.output, fee: best.fee, createdAt: Date.now() };
    return { id, tokenIn: input, tokenOut: input === 'USDT' ? 'USDC' : 'USDT', amountIn: humanAmount, estimatedOut: formatUnits(best.output, 6), minOut: formatUnits(minOut, 6), poolFeePercent: (best.fee / 10000).toString(), expiresAt: new Date(Date.now() + 300_000).toISOString() };
  },
  async executeSwap({ quoteId, password, locale }: { quoteId: unknown; password: unknown; locale?: unknown }, app: any) {
    if (sending) throw new Error('Another transaction is already being sent.');
    sending = true;
    const approvals: Hex[] = [];
    try {
      const quote = pendingSwap;
      if (typeof quoteId !== 'string' || !quote || quote.id !== quoteId || Date.now() - quote.createdAt > 300_000) throw new Error('Swap quote expired. Request a new quote.');
      if ((await activeWallet(app))?.address.toLowerCase() !== quote.sender.toLowerCase()) throw new Error('Selected wallet changed. Request a new quote.');
      const key = await decryptKey(await savedVault(app, quote.sender), paymentPassword(password));
      const account = privateKeyToAccount(key);
      if (account.address.toLowerCase() !== quote.sender.toLowerCase()) throw new Error('Signing key does not match the selected wallet.');
      const { publicClient, url } = await clients(app);
      const tokenIn = TOKENS[quote.tokenIn];
      const tokenOutSymbol = quote.tokenIn === 'USDT' ? 'USDC' : 'USDT';
      const tokenOut = TOKENS[tokenOutSymbol];
      const minOut = quote.quotedOut * 995n / 1000n;
      const balance = await publicClient.readContract({ address: tokenIn, abi: ABI, functionName: 'balanceOf', args: [account.address] });
      if (balance < quote.amountIn) throw new Error(`Not enough ${quote.tokenIn}.`);
      const allowance = await publicClient.readContract({ address: tokenIn, abi: ABI, functionName: 'allowance', args: [account.address, ROUTER] });
      const approvalCount = allowance < quote.amountIn ? (quote.tokenIn === 'USDT' && allowance > 0n ? 2 : 1) : 0;
      const fees = await publicClient.estimateFeesPerGas();
      const maxCost = (300_000n + BigInt(approvalCount) * 100_000n) * fees.maxFeePerGas;
      const ethBalance = await publicClient.getBalance({ address: account.address });
      if (ethBalance < maxCost) throw new Error('Not enough ETH for the maximum estimated network fees.');
      const nowQuote = await swapQuote(publicClient, quote.tokenIn, quote.amountIn, quote.fee);
      if (nowQuote[0] < minOut) throw new Error('Exchange rate changed. Request a new quote.');
      const english = locale === 'en';
      const approved = await app.dialog.confirm(english ? `Swap ${formatUnits(quote.amountIn, 6)} ${quote.tokenIn} for ${tokenOutSymbol}?` : `Обменять ${formatUnits(quote.amountIn, 6)} ${quote.tokenIn} на ${tokenOutSymbol}?`, {
        detail: english ? `Network: Ethereum mainnet\nWallet: ${account.address}\nQuoted: ${formatUnits(quote.quotedOut, 6)} ${tokenOutSymbol}\nMinimum received: ${formatUnits(minOut, 6)} ${tokenOutSymbol}\nUniswap v3 pool fee: ${quote.fee / 10000}%\nRouter: ${ROUTER}\nApproval transactions: ${approvalCount}\nMaximum estimated network fees: ${formatEther(maxCost)} ETH\nIf the swap fails after approval, the exact-amount allowance remains.` : `Сеть: Ethereum mainnet\nКошелёк: ${account.address}\nКотировка: ${formatUnits(quote.quotedOut, 6)} ${tokenOutSymbol}\nМинимум к получению: ${formatUnits(minOut, 6)} ${tokenOutSymbol}\nКомиссия пула Uniswap v3: ${quote.fee / 10000}%\nРоутер: ${ROUTER}\nТранзакций разрешения: ${approvalCount}\nМаксимум комиссии сети по оценке: ${formatEther(maxCost)} ETH\nЕсли обмен не пройдёт после разрешения, право списать точную сумму останется.`,
        ok: english ? 'Swap now' : 'Обменять сейчас', cancel: english ? 'Cancel' : 'Отмена',
      });
      if (!approved) { pendingSwap = null; return { cancelled: true }; }
      if ((await activeWallet(app))?.address.toLowerCase() !== account.address.toLowerCase() || Date.now() - quote.createdAt > 300_000) throw new Error('Wallet or quote changed. Request a new quote.');
      pendingSwap = null;
      const walletClient = createWalletClient({ account, chain: mainnet, transport: http(url) });
      const approveAmount = async (value: bigint) => {
        const args = [ROUTER, value] as const;
        const estimated = await publicClient.estimateContractGas({ address: tokenIn, abi: ABI, functionName: 'approve', args, account });
        const hash = await walletClient.writeContract({ address: tokenIn, abi: ABI, functionName: 'approve', args, gas: estimated * 12n / 10n, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas });
        approvals.push(hash);
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== 'success') throw new Error('Token approval failed.');
      };
      if (allowance < quote.amountIn) {
        if (quote.tokenIn === 'USDT' && allowance > 0n) await approveAmount(0n);
        await approveAmount(quote.amountIn);
      }
      const finalQuote = await swapQuote(publicClient, quote.tokenIn, quote.amountIn, quote.fee);
      if (finalQuote[0] < minOut) throw new Error('Exchange rate changed after approval. Request a new quote.');
      const params = { tokenIn, tokenOut, fee: quote.fee, recipient: account.address, deadline: BigInt(Math.floor(Date.now() / 1000) + 300), amountIn: quote.amountIn, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n };
      await publicClient.simulateContract({ address: ROUTER, abi: ROUTER_ABI, functionName: 'exactInputSingle', args: [params], account });
      const gas = await publicClient.estimateContractGas({ address: ROUTER, abi: ROUTER_ABI, functionName: 'exactInputSingle', args: [params], account });
      if (await publicClient.getBalance({ address: account.address }) < gas * fees.maxFeePerGas) throw new Error('Not enough ETH for the swap network fee.');
      const nonce = await publicClient.getTransactionCount({ address: account.address, blockTag: 'pending' });
      await ensureNonceAvailable(app, account.address, nonce);
      const serialized = await walletClient.signTransaction({ account, chain: mainnet, to: ROUTER, data: encodeFunctionData({ abi: ROUTER_ABI, functionName: 'exactInputSingle', args: [params] }), nonce, gas: gas * 12n / 10n, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas });
      const transactionHash = keccak256(serialized);
      const submittedAt = new Date().toISOString();
      const previous = await readPayments(app);
      const payments = [{ kind: 'swap', hash: transactionHash, nonce, sender: account.address, recipient: account.address, token: quote.tokenIn, tokenOut: tokenOutSymbol, amount: formatUnits(quote.amountIn, 6), expectedOut: formatUnits(quote.quotedOut, 6), minOut: formatUnits(minOut, 6), description: '', counterparty: '', submittedAt, date: null, status: 'pending' }, ...previous].slice(0, 100);
      if (!(await app.store.set(PAYMENTS, payments))) throw new Error('Could not save the transaction; swap was not sent.');
      let submitted = true;
      try { await publicClient.sendRawTransaction({ serializedTransaction: serialized }); }
      catch { submitted = false; }
      if (!submitted) throw new Error(locale === 'en' ? `The swap transaction may already be sent: ${transactionHash}. Check its status in History before retrying.` : `Транзакция обмена могла быть отправлена: ${transactionHash}. Проверьте её статус в истории, прежде чем повторять.`);
      return { hash: transactionHash, approvalHashes: approvals, metadataSaved: true };
    } catch (error: any) {
      if (approvals.length) throw new Error(`${locale === 'en' ? 'Approval transaction(s)' : 'Транзакции разрешения'}: ${approvals.join(', ')}. ${error?.message ?? ''}`);
      throw error;
    } finally { sending = false; }
  },
  async sendToken({ walletAddress, recipient, value, token, password, description, locale }: { walletAddress: unknown; recipient: unknown; value: unknown; token: unknown; password: unknown; description: unknown; locale?: unknown }, app: any) {
    if (sending) throw new Error('Отправка уже выполняется.');
    sending = true;
    try {
      const to = address(recipient);
      const humanAmount = amount(value);
      const symbol = tokenSymbol(token);
      const contract = TOKENS[symbol];
      if (typeof description !== 'string' || description.length > 300) throw new Error('Описание платежа должно быть короче 300 символов.');
      const note = description.trim().replace(/\s+/g, ' ');
      const selected = await activeWallet(app);
      const from = address(walletAddress);
      if (!selected || selected.address.toLowerCase() !== from.toLowerCase()) throw new Error('Selected wallet changed. Review the payment again.');
      const key = await decryptKey(await savedVault(app, from), paymentPassword(password));
      const account = privateKeyToAccount(key);
      if (account.address.toLowerCase() !== from.toLowerCase()) throw new Error('Signing key does not match the selected wallet.');
      const { publicClient, url } = await clients(app);
      const rawAmount = parseUnits(humanAmount, 6);
      const balance = await network(() => publicClient.readContract({ address: contract, abi: ABI, functionName: 'balanceOf', args: [account.address] }));
      if (balance < rawAmount) throw new Error(`Not enough ${symbol}.`);
      const gas = await network(() => publicClient.estimateContractGas({ address: contract, abi: ABI, functionName: 'transfer', args: [to, rawAmount], account }));
      const fees = await network(() => publicClient.estimateFeesPerGas());
      const maxCost = gas * fees.maxFeePerGas;
      const ethBalance = await network(() => publicClient.getBalance({ address: account.address }));
      if (ethBalance < maxCost) throw new Error('Недостаточно ETH для комиссии.');
      const contacts = await readContacts(app);
      const contact = contacts.find((item) => item.address.toLowerCase() === to.toLowerCase());
      const english = locale === 'en';
      const approved = await app.dialog.confirm(english ? `Send ${humanAmount} ${symbol}?` : `Отправить ${humanAmount} ${symbol}?`, {
        detail: english ? `Network: Ethereum mainnet\nFrom: ${account.address}\nContact: ${contact?.name ?? 'not saved'}\nTo: ${to}\nNote: ${note || '—'}\nContract: ${contract}\nMaximum fee: ${formatEther(maxCost)} ETH` : `Сеть: Ethereum mainnet\nОт: ${account.address}\nКонтрагент: ${contact?.name ?? 'не сохранён'}\nКому: ${to}\nОписание: ${note || '—'}\nКонтракт: ${contract}\nМаксимальная комиссия: ${formatEther(maxCost)} ETH`,
        ok: english ? 'Send now' : 'Отправить сейчас', cancel: english ? 'Cancel' : 'Отмена',
      });
      if (!approved) return { cancelled: true };
      if ((await activeWallet(app))?.address.toLowerCase() !== from.toLowerCase()) throw new Error('Selected wallet changed. Review the payment again.');
      const walletClient = createWalletClient({ account, chain: mainnet, transport: http(url) });
      // Sign before broadcasting so the hash is known even if the RPC answer
      // is lost: an accepted-but-unconfirmed transaction must never look like
      // "nothing was sent" and invite a duplicate payment.
      const nonce = await network(() => publicClient.getTransactionCount({ address: account.address, blockTag: 'pending' }));
      await ensureNonceAvailable(app, account.address, nonce);
      const serialized = await walletClient.signTransaction({ account, chain: mainnet, to: contract, data: encodeFunctionData({ abi: ABI, functionName: 'transfer', args: [to, rawAmount] }), nonce, gas, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas });
      const transactionHash = keccak256(serialized);
      const submittedAt = new Date().toISOString();
      const previous = await readPayments(app);
      const payments = [{ hash: transactionHash, nonce, sender: from, recipient: to, token: symbol, amount: humanAmount, description: note, counterparty: contact?.name ?? '', submittedAt, date: null, status: 'pending' }, ...previous].slice(0, 100);
      if (!(await app.store.set(PAYMENTS, payments))) throw new Error('Could not save the transaction; payment was not sent.');
      let submitted = true;
      try { await network(() => publicClient.sendRawTransaction({ serializedTransaction: serialized })); }
      catch { submitted = false; }
      if (!submitted) throw new Error(english ? `The transaction may already be sent: ${transactionHash}. Check its status in History before retrying.` : `Транзакция могла быть отправлена: ${transactionHash}. Проверьте её статус в истории, прежде чем повторять.`);
      return { hash: transactionHash, submittedAt, metadataSaved: true };
    } finally { sending = false; }
  },
};
