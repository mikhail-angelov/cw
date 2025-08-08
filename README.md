# CW USDT/ETH CLI crypto wallet

A Node.js command-line wallet for interacting with USDT (Tether) and ETH on the Ethereum mainnet (or testnet).
Supports balance checks, transaction history, status queries, secure key management, and sending USDT.

## Features

- **Check USDT and ETH balance** for any Ethereum address
- **Show last 3 USDT transactions** (incoming/outgoing) for an address
- **Query status** of a transaction by hash
- **Send USDT** to any account (requires sender's private key)
- **Create new wallet** (address + private key)
- **Encrypt/decrypt your private key** with a password phrase
- Simple CLI built with [commander](https://github.com/tj/commander.js) and [ethers.js](https://docs.ethers.org/)

## Prerequisites

- Node.js v16+
- npm
- Ethereum account (mainnet or Sepolia testnet)
- USDT contract address (mainnet: `0xdAC17F958D2ee523a2206206994597C13D831ec7`)
- API key for [Infura](https://infura.io/)

## Setup

1. **Clone the repository**
   ```sh
   git clone <your-repo-url>
   cd cw
   ```

2. **Install dependencies**
   ```sh
   npm install
   ```

3. **Configure environment variables**
   Create a `.env` file in the `cw` directory:
   ```
   INFURA_API_KEY=your_infura_project_id
   USDT_CONTRACT=usdt_contract_address_on_mainnet
   PRIVATE_KEY=your_private_key_for_sending_usdt
   ```
   - `PRIVATE_KEY` is only required for sending USDT.
   - For mainnet, use the official USDT contract: `0xdAC17F958D2ee523a2206206994597C13D831ec7`

4. **Verify USDT ABI**
   The ABI for USDT should be present in `usdt-abi.json` and must include the `Transfer` event.

## CLI Usage

All commands are run from the project root:

```sh
node cli.js <command> [options]
```

### Commands & Examples

#### Check Balance

Shows both USDT and ETH balances for the given Ethereum address.

```sh
node cli.js balance 0xYourAddress
```
**Example Output:**
```
USDT Balance: 123.45 (0xYourAddress)
ETH Balance: 0.6789 (0xYourAddress)
```

#### Show Last 3 USDT Transactions

Displays the last 3 USDT transactions (incoming/outgoing) for the address.

```sh
node cli.js last 0xYourAddress
```
**Example Output:**
```
#1: Hash: 0xabc...123
  From: 0xSender
  To: 0xYourAddress
  Value: 50 USDT
  Block: 18000000

#2: Hash: 0xdef...456
  From: 0xYourAddress
  To: 0xRecipient
  Value: 10 USDT
  Block: 17999999

#3: Hash: 0xghi...789
  From: 0xOther
  To: 0xYourAddress
  Value: 5 USDT
  Block: 17999998
```

#### Transaction Status

Shows the status (success/failure, block, gas used) of a transaction by its hash.

```sh
node cli.js status 0xTxHashHere
```
**Example Output:**
```
Status: Success
Block: 18000001
Gas Used: 51234
```

#### Send USDT

Sends the specified amount of USDT to the recipient address.
Requires `PRIVATE_KEY` in `.env` to sign the transaction.

```sh
node cli.js send 0xRecipientAddress 10
```
**Example Output:**
```
Transaction sent! Tx Hash: 0xabc...def
Transfer successful! Tx Hash: 0xabc...def, used 65000 gas
```

#### Create Wallet

Generates a new Ethereum wallet (address + private key).

```sh
node cli.js create
```
**Example Output:**
```
New Wallet:
Address: 0xNewAddress
Private Key: 0xNewPrivateKey
```

#### Encrypt/Decrypt Private Key

Encrypts your private key with a password phrase and saves it to `priv.key`.

```sh
node cli.js encrypt-key
```
**Example Output:**
```
Enter password phrase to encrypt PRIVATE_KEY:
Encrypted PRIVATE_KEY saved to priv.key
```

Decrypts and prints your private key from `priv.key`.

```sh
node cli.js decrypt-key
```
**Example Output:**
```
Enter password phrase to decrypt PRIVATE_KEY:
PRIVATE_KEY: 0xYourPrivateKey
```

#### Show App Info

Shows app info from `package.json`.

```sh
node cli.js show-info
```
**Example Output:**
```
App Name: cw
Version: 1.0.0
Description: usdt/eth wallet
```

## Example Workflow

```sh
# Check balances
node cli.js balance 0xYourAddress

# View recent USDT transactions
node cli.js last 0xYourAddress

# Check transaction status
node cli.js status 0xTxHashHere

# Send USDT
node cli.js send 0xRecipientAddress 10

# Create a new wallet
node cli.js create

# Encrypt your private key
node cli.js encrypt-key

# Decrypt your private key
node cli.js decrypt-key
```

## Security Notes

- **Never share your private key.**
- Always use password encryption for your private key.
- For mainnet, ensure you have enough ETH for gas fees.
- For testing, use Sepolia or other testnets.

## Extending

- Add more ERC20 commands by extending `app.js` and `cli.js`.
- Integrate with other Ethereum networks by changing RPC endpoints.

## License

MIT
