# CW Wallet

A compact macOS app for viewing Ethereum and TRON balances, sending USDT/USDC, and swapping USDT ↔ USDC on Ethereum. The interface is available in Russian and English. Built with [tinyjs](https://tinyjs.app/).

<img height="480" alt="image" src="https://github.com/user-attachments/assets/23cb8c16-9711-4ef6-9e13-fd73b7e6d8cc" />

## Wallets and security

- Add multiple public addresses and switch between them at the top of the window. Private keys are not required to view balances.
- You can add a separate signing key for each address. It is encrypted with a payment password using scrypt and AES-GCM and stored in macOS Keychain under that address's key. The password must be entered manually for every payment; the app does not save it.
- Copy the selected wallet address with one button. You can copy the private key after entering the password, completing system authentication, and giving separate confirmation. If the clipboard has not changed, the app clears it after 30 seconds; clipboard managers and Universal Clipboard may retain a copy.
- Removing an address does not delete its key: delete the key separately first.
- Balances are read through a public Ethereum RPC, with Blockscout as a fallback. Transfer history is requested **only** after clicking “Load history” in the History section. Data for the selected address is kept separate from other addresses.
- For each selected Ethereum address, the app shows the corresponding TRON address derived from the same public key, along with its TRX and official USDT TRC-20 balances. TRON balances are read through TronGrid. This is a separate network: USDT in the Ethereum column is already ERC-20 and does not need to be transferred.
- Counterparties and payment notes are stored locally in the app settings and are not sent to the blockchain. The payment date appears after network confirmation. Payments are sent immediately after confirmation in the app.
- Payments support native USDT and USDC on Ethereum mainnet. Swaps use direct Uniswap v3 pools, with a quote valid for 5 minutes, a minimum received amount 0.5% below the quote, and a block on quotes more than 5% worse than 1:1. The first swap may require a separate token approval transaction and ETH for network fees; approval is limited to the exact amount. Before submission, the app shows the router address, the number of approvals, and the estimated maximum fee. Actual swaps using funds are not part of the automated checks.
- A personal Infura Project ID is optional: the app uses a public Ethereum RPC. To send funds, you only need the selected wallet's protected private key and a payment password that you set yourself (at least 12 characters) and enter manually each time. Importing from cwg requires the old cwg password and a new app password. When creating a new wallet, save the displayed private key as a backup.

## Local build

Requires Node.js 24, npm 11, and [tinyjs 0.67.0](https://github.com/tarwin/tinyjsapp/releases/tag/v0.67.0). npm 11 applies the pinned transitive dependency overrides.

```sh
npm ci
npm run build
open 'dist/CW Wallet.app'
```

Universal archive for Apple Silicon and Intel:

```sh
npm run build -- --universal
npm run package:mac
```

## Install with Homebrew

```sh
brew install --cask mikhail-angelov/tap/cw-wallet
```

The app is not notarized by Apple. On first launch, macOS may ask you to allow it in System Settings → Privacy & Security.

The original CLI remains in `cli.js`.
