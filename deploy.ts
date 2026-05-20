import { ccc } from "@ckb-ccc/core";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { createDevnetClient, ACCOUNTS } from "./config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const client = createDevnetClient();
  const signer = new ccc.SignerCkbPrivateKey(client, ACCOUNTS.primary);
  const addressObj = await signer.getRecommendedAddressObj();

  console.log("Using deployer address:", addressObj.toString());

  const binaryPath = path.resolve(__dirname, "../../ckb-scripts/agent-lock/build/release/agent-lock");
  if (!fs.existsSync(binaryPath)) {
    throw new Error(`Compiled agent-lock binary not found at ${binaryPath}. Did you run 'make build' in ckb-scripts/agent-lock?`);
  }
  const binaryBuffer = fs.readFileSync(binaryPath);
  const dataHex = ccc.hexFrom(binaryBuffer);

  console.log("Binary size:", binaryBuffer.length, "bytes");

  const tx = ccc.Transaction.from({
    outputs: [{ lock: addressObj.script, capacity: 0n }],
    outputsData: [dataHex],
  });

  const occupied = BigInt(tx.outputs[0].occupiedSize);
  const binaryLen = BigInt(binaryBuffer.length);
  tx.outputs[0].capacity = (occupied + binaryLen) * 100000000n;
  console.log("Calculated deployment cell capacity:", Number(tx.outputs[0].capacity / 100000000n), "CKB");

  console.log("Completing inputs...");
  await tx.completeInputsByCapacity(signer);
  console.log("Completing fee...");
  await tx.completeFeeBy(signer, 1000n);

  console.log("Sending deployment transaction...");
  const txHash = await signer.sendTransaction(tx);
  console.log("\nSuccess! Deployment transaction sent.");

  const codeHash = ccc.hashCkb(binaryBuffer);
  console.log("\n--- DEPLOYED SCRIPT METADATA ---");
  console.log("Update experiments/agent-lock/config.ts with:");
  console.log(`code_hash: ${codeHash}`);
  console.log(`hash_type: data2`);
  console.log(`out_point.tx_hash: ${txHash}`);
  console.log("--------------------------------\n");
}

main().catch(console.error);
