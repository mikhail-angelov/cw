const { ethers } = require("ethers");
const readline = require("readline");
const crypto = require("crypto");
const fs = require("fs");

// Provider setup
const provider = new ethers.JsonRpcProvider(
  `https://mainnet.infura.io/v3/${process.env.INFURA_API_KEY}`,
);

// USDT contract setup
const usdtABI = require("./usdt-abi.json");
const usdtContract = new ethers.Contract(
  process.env.USDT_CONTRACT,
  usdtABI,
  provider,
);

// Create new wallet
async function createWallet() {
  const wallet = ethers.Wallet.createRandom();
  console.log(
    `New Wallet:\nAddress: ${wallet.address}\nPrivate Key: ${wallet.privateKey}`,
  );
  return wallet;
}

// Check USDT and ETH balance
async function checkBalance(address) {
  if (!ethers.isAddress(address)) {
    throw new Error(`Invalid Ethereum address: ${address}`);
  }

  // USDT balance
  const balance = await usdtContract.balanceOf(address);
  const decimals = await usdtContract.decimals();
  const formattedBalance = Number(balance) / Math.pow(10, Number(decimals));
  console.log(`USDT Balance: ${formattedBalance} (${address})`);

  // ETH balance
  const ethBalanceWei = await provider.getBalance(address);
  const ethBalance = ethers.formatEther(ethBalanceWei);
  console.log(`ETH Balance: ${ethBalance} (${address})`);

  return { usdt: formattedBalance, eth: ethBalance };
}

// Transaction status
async function transactionStatus(txHash) {
  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) {
    console.log("Transaction not found or not yet mined.");
  } else {
    console.log(`Status: ${receipt.status ? "Success" : "Failed"}`);
    console.log(`Block: ${receipt.blockNumber}`);
    console.log(`Gas Used: ${receipt.gasUsed}`);
  }
}

// Last 3 USDT transactions for an address
async function lastTransaction(address) {
  try {
    if (!ethers.isAddress(address)) {
      throw new Error(`Invalid Ethereum address: ${address}`);
    }

    // Get latest block number
    const latestBlock = await provider.getBlockNumber();
    const fromBlock = Math.max(latestBlock - 5000, 0);

    // Ensure ABI includes Transfer event!
    const eventFragment = usdtContract.interface.getEvent("Transfer");
    const transferTopic = usdtContract.interface.getTopic(eventFragment);

    // Get logs for Transfer events
    const logs = await provider.getLogs({
      address: process.env.USDT_CONTRACT,
      fromBlock,
      toBlock: latestBlock,
      topics: [transferTopic],
    });

    const decimals = await usdtContract.decimals();
    const relevantTxs = logs
      .map((log) => {
        const event = usdtContract.interface.decodeLog(
          eventFragment,
          log.data,
          log.topics,
        );
        return {
          hash: log.transactionHash,
          from: event.from,
          to: event.to,
          value: ethers.formatUnits(event.value, decimals),
          blockNumber: log.blockNumber,
        };
      })
      .filter(
        (tx) =>
          tx.from.toLowerCase() === address.toLowerCase() ||
          tx.to.toLowerCase() === address.toLowerCase(),
      )
      .slice(-3)
      .reverse();

    if (relevantTxs.length === 0) {
      console.log("No recent USDT transactions found for this address.");
      return;
    }

    relevantTxs.forEach((tx, i) => {
      console.log(
        `#${i + 1}: Hash: ${tx.hash}\n  From: ${tx.from}\n  To: ${tx.to}\n  Value: ${tx.value} USDT\n  Block: ${tx.blockNumber}\n`,
      );
    });
  } catch (err) {
    console.error("Error fetching last transactions:", err.message);
  }
}

// Transfer USDT
async function transferUSDT(recipient, amount) {
  let privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    privateKey = await decriptKey();
  }
  if (!privateKey) {
    throw new Error("PRIVATE KEY not found :(.");
  }
  if (!ethers.isAddress(recipient)) {
    throw new Error(`Invalid recipient address: ${recipient}`);
  }

  const wallet = new ethers.Wallet(privateKey, provider);
  const contractWithSigner = usdtContract.connect(wallet);

  const decimals = await usdtContract.decimals();
  const rawAmount = ethers.parseUnits(amount.toString(), decimals);

  // Estimate gas
  const gasEstimate = await contractWithSigner.transfer.estimateGas(
    recipient,
    rawAmount,
  );

  // Get current gas price
  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice;

  // Send transaction
  const txResponse = await contractWithSigner.transfer(recipient, rawAmount, {
    gasLimit: gasEstimate,
    gasPrice: gasPrice,
  });

  console.log(`Transaction sent! Tx Hash: ${txResponse.hash}`);
  const receipt = await txResponse.wait();
  console.log(
    `Transfer successful! Tx Hash: ${receipt.hash}, used ${receipt.gasUsed} gas`,
  );
}

// Encrypt PRIVATE_KEY with password phrase and save to priv.key
async function encryptKey() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  function ask(query) {
    return new Promise((resolve) => rl.question(query, resolve));
  }

  try {
    const phrase = await ask("Enter password phrase to encrypt PRIVATE KEY: ");
    rl.close();

    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) {
      throw new Error("PRIVATE KEY not found in environment.");
    }

    // Encrypt using AES-256-GCM
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const key = crypto.scryptSync(phrase, salt, 32);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

    let encrypted = cipher.update(privateKey, "utf8", "hex");
    encrypted += cipher.final("hex");
    const tag = cipher.getAuthTag();

    // Save as single string: salt:iv:tag:encrypted
    const outString = [
      salt.toString("hex"),
      iv.toString("hex"),
      tag.toString("hex"),
      encrypted,
    ].join(":");
    fs.writeFileSync("priv.key", outString);
    console.log("Encrypted PRIVATE KEY saved to priv.key");
  } catch (err) {
    console.error("Encryption failed:", err.message);
    process.exit(1);
  }
}

// Decrypt PRIVATE_KEY from priv.key with password phrase
async function decriptKey() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  function ask(query) {
    return new Promise((resolve) => rl.question(query, resolve));
  }

  try {
    const phrase = await ask("Enter password phrase to decrypt PRIVATE KEY: ");
    rl.close();

    if (!fs.existsSync("priv.key")) {
      console.error("priv.key file not found.");
      process.exit(1);
    }
    const data = fs.readFileSync("priv.key", "utf8").trim();
    const [saltHex, ivHex, tagHex, encrypted] = data.split(":");
    if (!saltHex || !ivHex || !tagHex || !encrypted) {
      console.error("priv.key format invalid.");
      process.exit(1);
    }
    const salt = Buffer.from(saltHex, "hex");
    const iv = Buffer.from(ivHex, "hex");
    const tag = Buffer.from(tagHex, "hex");
    const key = crypto.scryptSync(phrase, salt, 32);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    console.log("PRIVATE KEY:", decrypted);
    return decrypted;
  } catch (err) {
    console.error("Decryption failed:", err.message);
    process.exit(1);
  }
}

module.exports = {
  provider,
  createWallet,
  checkBalance,
  transferUSDT,
  encryptKey,
  lastTransaction,
  transactionStatus,
  decriptKey,
};
