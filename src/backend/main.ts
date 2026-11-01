import { createPublicClient, createWalletClient, encodeFunctionData, formatEther, formatUnits, getAddress, hexToBytes, http, isAddress, keccak256, parseAbi, parseUnits, toHex, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { mainnet } from 'viem/chains';
import { scryptAsync } from '@noble/hashes/scrypt.js';
import { TronWeb } from 'tronweb';
import { createClient as createLiFiClient, convertQuoteToRoute, executeRoute, getQuote, getStatus } from '@lifi/sdk';
import { TronProvider } from '@lifi/sdk-provider-tron';
import { EthereumProvider } from '@lifi/sdk-provider-ethereum';

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
const KEY = 'private-key';
const VAULT = 'wallet-vault-v1';
const INFURA = 'infura-api-key';
const WATCH = 'watched-address';
const OVERVIEW = 'last-overview';
const WALLETS = 'wallets-v2';
const ACTIVE = 'active-wallet-v2';
const CONTACTS = 'counterparties';
const PAYMENTS = 'payments';
const BRIDGES = 'bridge-transfers-v1';
const TRON_USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const TRON_ID = 728126428;
const tronOverviewName = (who: string) => `tron-overview-v1:${who.toLowerCase()}`;
let sending = false;
let pendingSwap: { id: string; sender: Hex; tokenIn: TokenSymbol; amountIn: bigint; quotedOut: bigint; fee: number; createdAt: number } | null = null;
type BridgeDirection = 'TRON_TO_ETH' | 'ETH_TO_TRON';
type PendingBridge = { id: string; sender: Hex; source: string; destination: string; direction: BridgeDirection; amountIn: bigint; minOut: bigint; quote: any; createdAt: number };
let pendingBridge: PendingBridge | null = null;

type Vault = { version: 1; address: Hex; salt: Hex; iv: Hex; ciphertext: Hex };
type WalletEntry = { address: Hex; label: string };
type Counterparty = { name: string; address: Hex; description: string; createdAt: string; lastPaymentAt: string | null };

const vaultName = (who: string) => `wallet-vault-v2:${who.toLowerCase()}`;
const overviewName = (who: string) => `overview-v2:${who.toLowerCase()}`;

async function walletList(app: any): Promise<WalletEntry[]> {
  const saved = await app.store.get(WALLETS);
  if (Array.isArray(saved)) return saved.filter((item) => isAddress(item?.address));
  const oldAddress = await app.store.get(WATCH);
  const oldVault = await app.secrets.get(VAULT);
  const oldKey = await app.secrets.get(KEY);
  const vaultAddress = oldVault ? parseVault(oldVault).address : null;
  const keyAddress = oldKey ? privateKeyToAccount(oldKey).address : null;
  const initial = isAddress(oldAddress) ? getAddress(oldAddress) : vaultAddress ?? keyAddress;
  const wallets: WalletEntry[] = [];
  for (const who of [initial, vaultAddress, keyAddress]) if (who && !wallets.some((item) => item.address.toLowerCase() === who.toLowerCase())) wallets.push({ address: who, label: '' });
  if (oldVault && vaultAddress && !(await app.secrets.get(vaultName(vaultAddress)))) {
    await app.secrets.set(vaultName(vaultAddress), oldVault);
    if (await app.secrets.get(vaultName(vaultAddress)) !== oldVault) throw new Error('Could not migrate the existing signing key.');
    await markVault(app, vaultAddress, true);
  }
  if (!(await app.store.set(WALLETS, wallets))) throw new Error('Could not save wallet list.');
  if (initial) await app.store.set(ACTIVE, initial);
  if (oldVault) await app.secrets.delete(VAULT);
  return wallets;
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
// only when signing: payments, swaps, bridges and key export.
const KEY_FLAGS = 'key-flags-v1';
type KeyFlags = { vaults: Record<string, boolean>; legacyAddress: string | null; infuraPresent: boolean };
async function readKeyFlags(app: any): Promise<KeyFlags> {
  const saved = await app.store.get(KEY_FLAGS);
  return saved && typeof saved === 'object' && typeof saved.vaults === 'object'
    ? { vaults: saved.vaults, legacyAddress: saved.legacyAddress ?? null, infuraPresent: !!saved.infuraPresent }
    : { vaults: {}, legacyAddress: null, infuraPresent: false };
}
async function writeKeyFlags(app: any, flags: KeyFlags) { await app.store.set(KEY_FLAGS, flags); }
async function markVault(app: any, who: string | null | undefined, present: boolean) {
  if (!who) return;
  const flags = await readKeyFlags(app);
  const id = who.toLowerCase();
  if (present) flags.vaults[id] = true; else delete flags.vaults[id];
  await writeKeyFlags(app, flags);
}
async function markLegacyKey(app: any, address: string | null) {
  const flags = await readKeyFlags(app);
  flags.legacyAddress = address;
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
// Security guards: nothing is signed until the actual transaction matches the
// route the user confirmed. The called contract must be the approval address
// shown in the confirmation dialog, token approvals are exact-amount to that
// contract only, and no native currency may ever move (USDT-only bridging).
// Tool-specific router calldata cannot be decoded generically, so it is
// pinned to the confirmed contract instead.
const APPROVE_SELECTOR = '095ea7b3';
function checkEthBridgeTransaction(bridge: PendingBridge, tx: { to?: unknown; data?: unknown; value?: unknown }) {
  const to = typeof tx.to === 'string' ? tx.to.toLowerCase() : '';
  const data = typeof tx.data === 'string' ? tx.data.replace(/^0x/, '').toLowerCase() : '';
  const router = String(bridge.quote.estimate.approvalAddress ?? '').toLowerCase();
  const value = BigInt((tx.value as bigint | undefined) ?? 0n);
  if (!to || !router || !data) throw new Error('Rejected: the bridge transaction is incomplete.');
  if (value !== 0n) throw new Error('Rejected: the route tries to transfer native currency.');
  if (to === USDT.toLowerCase()) {
    if (data.slice(0, 8) !== APPROVE_SELECTOR) throw new Error('Rejected: unexpected token contract call.');
    const spender = `0x${data.slice(32, 72)}`;
    const approved = BigInt(`0x${data.slice(72, 136)}`);
    if (spender !== router || approved !== bridge.amountIn) throw new Error('Rejected: token approval does not match the confirmed route.');
  } else if (to !== router) throw new Error('Rejected: unknown bridge contract.');
}
function checkTronBridgeTransaction(bridge: PendingBridge, transaction: any) {
  const contracts = transaction?.raw_data?.contract;
  if (!Array.isArray(contracts) || contracts.length !== 1) throw new Error('Rejected: unexpected TRON transaction shape.');
  const entry = contracts[0];
  if (entry?.type !== 'TriggerSmartContract') throw new Error('Rejected: unexpected TRON transaction type.');
  const body = entry.parameter?.value ?? {};
  const owner = String(body.ownerAddress ?? '');
  const contract = String(body.contractAddress ?? '');
  const data = String(body.data ?? '').replace(/^0x/, '').toLowerCase();
  const router = String(bridge.quote.estimate.approvalAddress ?? '');
  if (owner !== bridge.source) throw new Error('Rejected: transaction owner does not match the source wallet.');
  if (BigInt(body.call_value ?? 0) !== 0n) throw new Error('Rejected: the route tries to transfer native TRX.');
  if (!contract || !router || !data) throw new Error('Rejected: the bridge transaction is incomplete.');
  if (contract === TRON_USDT) {
    if (data.slice(0, 8) !== APPROVE_SELECTOR) throw new Error('Rejected: unexpected TRC-20 contract call.');
    const spender = `0x${data.slice(32, 72)}`;
    const approved = BigInt(`0x${data.slice(72, 136)}`);
    if (spender !== TronWeb.address.toHex(router).replace(/^0x41/, '0x') || approved !== bridge.amountIn) throw new Error('Rejected: TRC-20 approval does not match the confirmed route.');
  } else if (contract !== router) throw new Error('Rejected: unknown TRON bridge contract.');
}
function guardedWalletClient(bridge: PendingBridge, client: any) {
  const guarded = Object.create(client);
  guarded.sendTransaction = async (args: any) => { checkEthBridgeTransaction(bridge, args); return client.sendTransaction(args); };
  return guarded;
}

async function bridgeClient(wallet?: any) {
  const client = createLiFiClient({ integrator: 'cw-wallet', providers: [TronProvider(wallet?.address?.startsWith('T') ? { getWallet: async () => wallet } : {}), EthereumProvider(wallet?.account ? { getWalletClient: async () => wallet, disableMessageSigning: true } : {})], rpcUrls: { [TRON_ID]: ['https://api.trongrid.io'], 1: ['https://ethereum-rpc.publicnode.com'] }, preloadChains: false, disableVersionCheck: true });
  if (wallet) {
    const response = await fetch('https://li.quest/v1/chains?chainTypes=TVM,EVM');
    if (!response.ok) throw new Error('Bridge network list is unavailable.');
    const result = await response.json();
    if (!Array.isArray(result.chains) || !result.chains.some((chain: any) => chain.id === TRON_ID)) throw new Error('TRON bridge support is unavailable.');
    client.setChains(result.chains);
  }
  return client;
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
  async quoteBridge({ walletAddress, value, direction }: { walletAddress: unknown; value: unknown; direction: unknown }, app: any) {
    if (sending) throw new Error('Another transaction is already being sent.');
    const who = address(walletAddress);
    if ((await activeWallet(app))?.address.toLowerCase() !== who.toLowerCase()) throw new Error('Selected wallet changed.');
    if (direction !== 'TRON_TO_ETH' && direction !== 'ETH_TO_TRON') throw new Error('Unsupported bridge direction.');
    const humanAmount = amount(value);
    const amountIn = parseUnits(humanAmount, 6);
    const source = direction === 'TRON_TO_ETH' ? tronAddress(who) : who;
    const destination = direction === 'TRON_TO_ETH' ? who : tronAddress(who);
    const fromChain = direction === 'TRON_TO_ETH' ? TRON_ID : 1;
    const toChain = direction === 'TRON_TO_ETH' ? 1 : TRON_ID;
    const fromToken = direction === 'TRON_TO_ETH' ? TRON_USDT : USDT;
    const toToken = direction === 'TRON_TO_ETH' ? USDT : TRON_USDT;
    const client = await bridgeClient();
    const quote = await getQuote(client, { fromChain, toChain, fromToken, toToken, fromAmount: amountIn.toString(), fromAddress: source, toAddress: destination });
    const same = (actual: string, expected: string, chain: number) => chain === TRON_ID ? actual === expected : actual.toLowerCase() === expected.toLowerCase();
    if (quote.action.fromChainId !== fromChain || quote.action.toChainId !== toChain || !same(quote.action.fromToken.address, fromToken, fromChain) || !same(quote.action.toToken.address, toToken, toChain) || !quote.action.fromAddress || !same(quote.action.fromAddress, source, fromChain) || !quote.action.toAddress || !same(quote.action.toAddress, destination, toChain) || BigInt(quote.action.fromAmount) !== amountIn) throw new Error('Bridge quote does not match the selected networks or addresses.');
    const route = convertQuoteToRoute(quote);
    if (route.steps.length !== 1 || route.steps[0].action.fromChainId !== fromChain || !quote.transactionRequest?.data) throw new Error('This bridge route is not supported by CW Wallet.');
    if (!quote.estimate.approvalAddress || !quote.transactionRequest?.to || String(quote.transactionRequest.to).toLowerCase() !== String(quote.estimate.approvalAddress).toLowerCase()) throw new Error('This bridge route is not supported by CW Wallet.');
    const minOut = BigInt(quote.estimate.toAmountMin);
    if (minOut < amountIn * 95n / 100n) throw new Error('Bridge fees exceed 5% of the amount; transfer blocked.');
    const id = toHex(crypto.getRandomValues(new Uint8Array(16)));
    pendingBridge = { id, sender: who, source, destination, direction, amountIn, minOut, quote, createdAt: Date.now() };
    const gasToken = direction === 'TRON_TO_ETH' ? 'TRX' : 'ETH';
    const gasUnits = direction === 'TRON_TO_ETH' ? 6 : 18;
    const gasAmount = (quote.estimate.gasCosts ?? []).filter((cost: any) => cost.token?.symbol === gasToken).reduce((total: bigint, cost: any) => total + BigInt(cost.amount), 0n);
    const routeFee = (quote.estimate.feeCosts ?? []).filter((cost: any) => cost.token?.symbol === 'USDT').reduce((total: bigint, cost: any) => total + BigInt(cost.amount), 0n);
    const destinationReady = direction === 'TRON_TO_ETH' ? true : (await tronBalances(who)).activated;
    return { id, source, destination, direction, amountIn: humanAmount, estimatedOut: formatUnits(BigInt(quote.estimate.toAmount), 6), minOut: formatUnits(minOut, 6), route: quote.toolDetails?.name ?? quote.tool, routeFee: formatUnits(routeFee, 6), estimatedGas: formatUnits(gasAmount, gasUnits), gasToken, destinationReady, expiresAt: new Date(Date.now() + 180_000).toISOString() };
  },
  async executeBridge({ quoteId, password, locale }: { quoteId: unknown; password: unknown; locale?: unknown }, app: any) {
    if (sending) throw new Error('Another transaction is already being sent.');
    sending = true;
    let sourceHash = '';
    try {
      const bridge = pendingBridge;
      if (typeof quoteId !== 'string' || !bridge || bridge.id !== quoteId || Date.now() - bridge.createdAt > 180_000) throw new Error('Bridge quote expired. Request a new quote.');
      if ((await activeWallet(app))?.address.toLowerCase() !== bridge.sender.toLowerCase()) throw new Error('Selected wallet changed.');
      const existing = await app.store.get(BRIDGES);
      if (Array.isArray(existing) && existing.some((item) => item.sender?.toLowerCase() === bridge.sender.toLowerCase() && item.status === 'pending')) throw new Error('A bridge transfer is still pending. Load history before trying again.');
      const key = await decryptKey(await savedVault(app, bridge.sender), paymentPassword(password));
      const account = privateKeyToAccount(key);
      if (account.address.toLowerCase() !== bridge.sender.toLowerCase()) throw new Error('Signing key does not match the selected wallet.');
      let gasText: string;
      let rpcUrl = '';
      if (bridge.direction === 'TRON_TO_ETH') {
        const balances = await tronBalances(bridge.sender);
        if (balances.usdt < bridge.amountIn) throw new Error('Not enough TRC-20 USDT in this TRON wallet.');
        const gasSun = (bridge.quote.estimate.gasCosts ?? []).filter((cost: any) => cost.token?.symbol === 'TRX').reduce((total: bigint, cost: any) => total + BigInt(cost.amount), 0n);
        if (balances.trx < gasSun) throw new Error('Not enough TRX for the estimated network fees.');
        gasText = `${formatUnits(gasSun, 6)} TRX`;
      } else {
        if (!(await tronBalances(bridge.sender)).activated) throw new Error('Activate your TRON address with a small TRX transfer before bridging USDT to it.');
        const { publicClient, url } = await clients(app);
        rpcUrl = url;
        const balance = await publicClient.readContract({ address: USDT, abi: ABI, functionName: 'balanceOf', args: [bridge.sender] });
        if (balance < bridge.amountIn) throw new Error('Not enough Ethereum USDT.');
        const approvalAddress = address(bridge.quote.estimate.approvalAddress);
        const allowance = await publicClient.readContract({ address: USDT, abi: ABI, functionName: 'allowance', args: [bridge.sender, approvalAddress] });
        const gasWei = (bridge.quote.estimate.gasCosts ?? []).filter((cost: any) => cost.token?.symbol === 'ETH').reduce((total: bigint, cost: any) => total + BigInt(cost.amount), 0n);
        const fees = await publicClient.estimateFeesPerGas();
        const maxWei = gasWei * 12n / 10n + (allowance < bridge.amountIn ? (allowance > 0n ? 2n : 1n) * 100_000n * fees.maxFeePerGas : 0n);
        if (await publicClient.getBalance({ address: bridge.sender }) < maxWei) throw new Error('Not enough ETH for the estimated network fees and token approval.');
        gasText = `${formatEther(maxWei)} ETH`;
      }
      const english = locale === 'en';
      const target = bridge.direction === 'TRON_TO_ETH' ? 'Ethereum' : 'TRON';
      const routeFee = (bridge.quote.estimate.feeCosts ?? []).filter((cost: any) => cost.token?.symbol === 'USDT').reduce((total: bigint, cost: any) => total + BigInt(cost.amount), 0n);
      const confirmed = await app.dialog.confirm(english ? `Bridge ${formatUnits(bridge.amountIn, 6)} USDT to ${target}?` : `Перенести ${formatUnits(bridge.amountIn, 6)} USDT в ${target}?`, {
        detail: english ? `From: ${bridge.source}\nTo: ${bridge.destination}\nMinimum received: ${formatUnits(bridge.minOut, 6)} USDT\nRoute: ${bridge.quote.toolDetails?.name ?? bridge.quote.tool}\nListed route fees: ${formatUnits(routeFee, 6)} USDT\nApproval address: ${bridge.quote.estimate.approvalAddress ?? '—'}\nEstimated source network fees: ${gasText}\nA token approval transaction may be required. Cross-chain delivery can take several minutes.` : `От: ${bridge.source}\nКому: ${bridge.destination}\nМинимум к получению: ${formatUnits(bridge.minOut, 6)} USDT\nМаршрут: ${bridge.quote.toolDetails?.name ?? bridge.quote.tool}\nКомиссии маршрута по котировке: ${formatUnits(routeFee, 6)} USDT\nАдрес разрешения: ${bridge.quote.estimate.approvalAddress ?? '—'}\nОценка комиссии исходной сети: ${gasText}\nМожет потребоваться отдельное разрешение токена. Межсетевой перевод занимает несколько минут.`,
        ok: english ? 'Bridge now' : 'Перенести сейчас', cancel: english ? 'Cancel' : 'Отмена',
      });
      if (!confirmed) { pendingBridge = null; return { cancelled: true }; }
      if ((await activeWallet(app))?.address.toLowerCase() !== bridge.sender.toLowerCase() || Date.now() - bridge.createdAt > 180_000) throw new Error('Wallet or quote changed. Request a new quote.');
      pendingBridge = null;
      const tronSigner = bridge.direction === 'TRON_TO_ETH' ? new TronWeb({ fullHost: 'https://api.trongrid.io' }) : null;
      const wallet = tronSigner ? { address: bridge.source, signTransaction: (transaction: any) => { checkTronBridgeTransaction(bridge, transaction); return tronSigner.trx.sign(transaction, key.slice(2)); } } : guardedWalletClient(bridge, createWalletClient({ account, chain: mainnet, transport: http(rpcUrl) }));
      const client = await bridgeClient(wallet);
      const route = convertQuoteToRoute(bridge.quote);
      let hashWrite: Promise<void> = Promise.resolve();
      const saveHash = async (txHash: string, status = 'pending') => {
        const previous = await app.store.get(BRIDGES);
        const records = Array.isArray(previous) ? previous : [];
        const record = { hash: txHash, sender: bridge.sender, source: bridge.source, destination: bridge.destination, direction: bridge.direction, fromChain: bridge.quote.action.fromChainId, toChain: bridge.quote.action.toChainId, amount: formatUnits(bridge.amountIn, 6), minOut: formatUnits(bridge.minOut, 6), route: bridge.quote.tool, submittedAt: new Date().toISOString(), status };
        await app.store.set(BRIDGES, [record, ...records.filter((item) => item.hash !== txHash)].slice(0, 100));
      };
      try {
        const finished = await executeRoute(client, route, { acceptExchangeRateUpdateHook: async ({ newToAmount }) => BigInt(newToAmount) >= bridge.minOut, updateRouteHook: (updated: any) => {
          // The SDK can accept route updates silently within its slippage
          // tolerance, so the confirmed minimum and the confirmed bridge
          // contract are enforced here, before anything is signed.
          const step = updated?.steps?.[0];
          if (BigInt(step?.estimate?.toAmountMin ?? 0n) < bridge.minOut) throw new Error('Rejected: the updated route minimum is below the confirmed minimum. Request a new quote.');
          const updatedTo = typeof step?.transactionRequest?.to === 'string' ? step.transactionRequest.to : '';
          if (!updatedTo || updatedTo.toLowerCase() !== String(bridge.quote.estimate.approvalAddress ?? '').toLowerCase()) throw new Error('Rejected: the updated route changes the bridge contract. Request a new quote.');
          const txHash = updated.steps?.[0]?.execution?.actions?.find((action: any) => action.type === 'CROSS_CHAIN' && action.txHash)?.txHash;
          if (txHash && !sourceHash) { sourceHash = txHash; hashWrite = saveHash(txHash).catch(() => {}); }
        } });
        const txHash = finished.steps?.[0]?.execution?.actions?.find((action: any) => action.type === 'CROSS_CHAIN' && action.txHash)?.txHash ?? sourceHash;
        if (!txHash) throw new Error('Bridge did not return a source transaction hash.');
        sourceHash = txHash;
        const partial = finished.steps?.[0]?.execution?.actions?.some((action: any) => action.substatus === 'PARTIAL');
        const status = finished.steps?.[0]?.execution?.status === 'DONE' ? partial ? 'partial' : 'confirmed' : 'pending';
        await hashWrite;
        await saveHash(txHash, status);
        return { hash: txHash, status };
      } catch (error: any) {
        if (sourceHash) { try { await hashWrite; await saveHash(sourceHash); } catch {} throw new Error(`${english ? 'Source transaction may have been sent' : 'Транзакция в исходной сети могла быть отправлена'}: ${sourceHash}. ${error?.message ?? ''}`); }
        throw error;
      }
    } finally { sending = false; }
  },
  async listBridges({ walletAddress }: { walletAddress: unknown }, app: any) {
    const who = address(walletAddress);
    const saved = await app.store.get(BRIDGES);
    const records = Array.isArray(saved) ? saved : [];
    const client = await bridgeClient();
    for (const record of records.filter((item) => item.sender?.toLowerCase() === who.toLowerCase() && item.status === 'pending').slice(0, 10)) {
      try {
        const result = await getStatus(client, { txHash: record.hash, fromChain: record.fromChain ?? TRON_ID, toChain: record.toChain ?? 1, bridge: record.route });
        if (result.status === 'DONE') record.status = result.substatus === 'PARTIAL' ? 'partial' : 'confirmed';
        else if (result.status === 'FAILED') record.status = 'failed';
      } catch { /* Leave the status pending until it can be checked. */ }
    }
    await app.store.set(BRIDGES, records);
    return records.filter((item) => item.sender?.toLowerCase() === who.toLowerCase());
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
    const oldKey = await app.secrets.get(KEY);
    if (await app.secrets.get(vaultName(who)) || (oldKey && privateKeyToAccount(oldKey).address.toLowerCase() === who.toLowerCase()))
      throw new Error('Remove the signing key before removing this wallet.');
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
    const saved = await app.store.get(overviewName(who)) ?? await app.store.get(OVERVIEW);
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
    const oldOverview = !savedOverview && activeAddress ? await app.store.get(OVERVIEW) : null;
    const cachedOverview = savedOverview ?? (oldOverview?.address?.toLowerCase() === activeAddress?.toLowerCase() ? oldOverview : null);
    const cachedTron = activeAddress ? await app.store.get(tronOverviewName(activeAddress)) : null;
    // Startup never reads Keychain: presence flags live in the plain store
    // and are learned when a secret is actually used (see savedVault and the
    // key setup actions). An unknown address is reported optimistically so an
    // existing install keeps working right after the update.
    const flags = await readKeyFlags(app);
    const knownVault = activeAddress ? flags.vaults[activeAddress.toLowerCase()] : undefined;
    const hasVault = knownVault === undefined ? true : !!knownVault;
    const needsPasswordSetup = !!(activeAddress && flags.legacyAddress && flags.legacyAddress.toLowerCase() === activeAddress.toLowerCase());
    return { wallets, activeAddress, cachedOverview, cachedTron, tronAddress: activeAddress ? tronAddress(activeAddress) : null, signerAddress: hasVault ? activeAddress : needsPasswordSetup ? flags.legacyAddress : null, hasInfuraKey: flags.infuraPresent, hasPaymentPassword: hasVault, needsPasswordSetup, keychainAvailable: true };
  },
  async setPaymentPassword({ password }: { password: unknown }, app: any) {
    const chosen = paymentPassword(password);
    const selected = await activeWallet(app);
    if (!selected) throw new Error('Select a wallet first.');
    const target = vaultName(selected.address);
    const existing = await app.secrets.get(target);
    if (existing) {
      await decryptKey(parseVault(existing), chosen);
      const oldKey = await app.secrets.get(KEY);
      if (oldKey && privateKeyToAccount(oldKey).address.toLowerCase() === selected.address.toLowerCase() && !(await app.secrets.delete(KEY))) throw new Error('Could not remove the old key.');
      await markLegacyKey(app, null);
      return true;
    }
    const legacy = await app.secrets.get(KEY);
    if (!legacy || privateKeyToAccount(legacy).address.toLowerCase() !== selected.address.toLowerCase()) throw new Error('Signing key was not found for this wallet.');
    await app.secrets.set(target, await encryptKey(legacy as Hex, chosen));
    if (!(await app.secrets.delete(KEY))) throw new Error('Зашифрованный ключ сохранён, но старую копию удалить не удалось. Повторите настройку пароля.');
    await markVault(app, selected.address, true);
    await markLegacyKey(app, null);
    return true;
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
    const legacyAddress = await app.store.get(WATCH);
    return (await refreshPendingPayments(app)).filter((item) => (item.sender ?? legacyAddress)?.toLowerCase() === who.toLowerCase()).slice(0, 20);
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
    const oldKey = await app.secrets.get(KEY);
    if (oldKey && privateKeyToAccount(oldKey).address.toLowerCase() === account.address.toLowerCase()) throw new Error('Protect the existing key with a password instead.');
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
    const oldKey = await app.secrets.get(KEY);
    if (oldKey && privateKeyToAccount(oldKey).address.toLowerCase() === account.address.toLowerCase()) throw new Error('Protect the existing key with a password instead.');
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
    const oldKey = await app.secrets.get(KEY);
    const legacy = oldKey && privateKeyToAccount(oldKey).address.toLowerCase() === selected.address.toLowerCase() ? oldKey : null;
    if (!stored && !legacy) throw new Error('Ключ не найден.');
    const english = locale === 'en';
    const confirmed = await app.dialog.confirm(english ? 'Remove this signing key?' : 'Удалить ключ подписи?', {
      detail: english ? `${selected.address}\nMake sure you have a backup of the private key. This cannot be undone.` : `${selected.address}\nУбедитесь, что у вас есть резервная копия приватного ключа. Это действие не отменить.`,
      ok: english ? 'Remove' : 'Удалить', cancel: english ? 'Cancel' : 'Отмена',
    });
    if (!confirmed) return false;
    if (stored && !(await app.secrets.delete(vaultName(selected.address)))) throw new Error('Could not remove the key from Keychain.');
    if (legacy && !(await app.secrets.delete(KEY))) throw new Error('Could not remove the old key from Keychain.');
    await markVault(app, selected.address, false);
    if (legacy) await markLegacyKey(app, null);
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
      const nonce = await publicClient.getTransactionCount({ address: account.address });
      const serialized = await walletClient.signTransaction({ account, chain: mainnet, to: ROUTER, data: encodeFunctionData({ abi: ROUTER_ABI, functionName: 'exactInputSingle', args: [params] }), nonce, gas: gas * 12n / 10n, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas });
      const transactionHash = keccak256(serialized);
      let submitted = true;
      try { await publicClient.sendRawTransaction({ serializedTransaction: serialized }); }
      catch { submitted = false; }
      let metadataSaved = false;
      try {
        const submittedAt = new Date().toISOString();
        const previous = await readPayments(app);
        const payments = [{ kind: 'swap', hash: transactionHash, sender: account.address, recipient: account.address, token: quote.tokenIn, tokenOut: tokenOutSymbol, amount: formatUnits(quote.amountIn, 6), expectedOut: formatUnits(quote.quotedOut, 6), minOut: formatUnits(minOut, 6), description: '', counterparty: '', submittedAt, date: null, status: 'pending' }, ...previous].slice(0, 100);
        metadataSaved = await app.store.set(PAYMENTS, payments);
      } catch { /* The transaction was already sent. */ }
      if (!submitted) throw new Error(locale === 'en' ? `The swap transaction may already be sent: ${transactionHash}. Check its status in History before retrying.` : `Транзакция обмена могла быть отправлена: ${transactionHash}. Проверьте её статус в истории, прежде чем повторять.`);
      return { hash: transactionHash, approvalHashes: approvals, metadataSaved };
    } catch (error: any) {
      if (approvals.length) throw new Error(`${locale === 'en' ? 'Swap was not sent. Approval transaction(s)' : 'Обмен не отправлен. Транзакции разрешения'}: ${approvals.join(', ')}. ${error?.message ?? ''}`);
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
      const nonce = await network(() => publicClient.getTransactionCount({ address: account.address }));
      const serialized = await walletClient.signTransaction({ account, chain: mainnet, to: contract, data: encodeFunctionData({ abi: ABI, functionName: 'transfer', args: [to, rawAmount] }), nonce, gas, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas });
      const transactionHash = keccak256(serialized);
      let submitted = true;
      try { await network(() => publicClient.sendRawTransaction({ serializedTransaction: serialized })); }
      catch { submitted = false; }
      const submittedAt = new Date().toISOString();
      let metadataSaved = false;
      try {
        const previous = await readPayments(app);
        const payments = [{ hash: transactionHash, sender: from, recipient: to, token: symbol, amount: humanAmount, description: note, counterparty: contact?.name ?? '', submittedAt, date: null, status: 'pending' }, ...previous].slice(0, 100);
        metadataSaved = await app.store.set(PAYMENTS, payments);
      } catch { /* The transaction was already sent. */ }
      if (!submitted) throw new Error(english ? `The transaction may already be sent: ${transactionHash}. Check its status in History before retrying.` : `Транзакция могла быть отправлена: ${transactionHash}. Проверьте её статус в истории, прежде чем повторять.`);
      return { hash: transactionHash, submittedAt, metadataSaved };
    } finally { sending = false; }
  },
};
