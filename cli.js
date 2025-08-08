const { program } = require("commander");
const pkg = require("./package.json");
require("dotenv").config();

const app = require("./app.js");

// Set CLI metadata
program
  .name(pkg.name || "cw-cli")
  .description(pkg.description || "Command-line interface for the cw app")
  .version(pkg.version || "0.1.0");

// create command
program
  .command("create")
  .description("Create new wallet")
  .action(async () => {
    try {
      await app.createWallet();
    } catch (err) {
      console.error("Error creating wallet:", err.message);
    }
  });
// balance command
program
  .command("balance <address>")
  .description("Check USDT balance for an address")
  .action(async (address) => {
    try {
      await app.checkBalance(address);
    } catch (err) {
      console.error("Error checking balance:", err.message);
    }
  });

// last command
program
  .command("last <address>")
  .description(
    "Show last 3 USDT transactions for an address (incoming/outgoing)",
  )
  .action(async (address) => {
    try {
      await app.lastTransaction(address);
    } catch (err) {
      console.error("Error checking last transactions:", err.message);
    }
  });

// status command
program
  .command("status <txHash>")
  .description("Show status of a transaction by hash")
  .action(async (txHash) => {
    try {
      await app.transactionStatus(txHash);
    } catch (err) {
      console.error("Error checking status:", err.message);
    }
  });

// send command
program
  .command("send <recipient> <amount>")
  .description("Send USDT to an account")
  .action(async (recipient, amount) => {
    try {
      await app.transferUSDT(recipient, amount);
    } catch (err) {
      console.error("Error sending USDT:", err.message);
    }
  });

// Example: show-info command
program
  .command("show-info")
  .description("Show app info from package.json")
  .action(() => {
    console.log("App Name:", pkg.name);
    console.log("Version:", pkg.version);
    console.log("Description:", pkg.description);
  });

program
  .command("encrypt-key")
  .description(
    "Encrypt PRIVATE_KEY  with a password phrase and save to priv.key",
  )
  .action(async () => {
    try {
      await app.encryptKey();
    } catch (err) {
      console.error("Error encrypt-key:", err.message);
    }
  });

program.parse(process.argv);

if (!process.argv.slice(2).length) {
  program.outputHelp();
}
