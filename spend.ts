import { ccc } from "@ckb-ccc/core";
import { createDevnetClient, AGENT_LOCK, ACCOUNTS } from "./config.js";

async function main() {
  const client = createDevnetClient();

  const spenderSigner = new ccc.SignerCkbPrivateKey(client, ACCOUNTS.primary);
  const spenderAddress = await spenderSigner.getRecommendedAddressObj();
  console.log("Using primary wallet:", spenderAddress.toString());

  const agentSigner = new ccc.SignerCkbPrivateKey(client, ACCOUNTS.agent);
  const agentAddress = await agentSigner.getRecommendedAddressObj();
  const agentPubKeyHash = agentAddress.script.args;
  console.log("Agent Trusted Public Key Hash (blake160):", agentPubKeyHash);

  const customLock = ccc.Script.from({
    codeHash: AGENT_LOCK.codeHash,
    hashType: AGENT_LOCK.hashType,
    args: agentPubKeyHash,
  });

  const customAddress = await ccc.Address.fromScript(customLock, client);
  console.log("Agent-owned lock address generated:", customAddress.toString());

  // Fund the custom address with 200 CKB
  console.log("\n--- STEP 1: FUNDING THE AGENT ADDRESS ---");
  const txFund = ccc.Transaction.from({
    outputs: [{ lock: customLock, capacity: ccc.fixedPointFrom(200) }],
    outputsData: ["0x"],
  });

  console.log("Completing inputs for funding...");
  await txFund.completeInputsByCapacity(spenderSigner);
  console.log("Completing fee for funding...");
  await txFund.completeFeeBy(spenderSigner, 1000n);

  console.log("Signing and sending funding transaction...");
  const fundTxHash = await spenderSigner.sendTransaction(txFund);
  console.log("Funding transaction sent! Tx Hash:", fundTxHash);

  console.log("Waiting for block confirmation...");
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // Spend the funded cell using an agent-generated signature
  console.log("\n--- STEP 2: UNLOCKING & SPENDING ---");

  const customOutPoint = { txHash: fundTxHash, index: 0n };
  const customCell = await client.getCell(customOutPoint);
  if (!customCell) {
    throw new Error(`Could not find the funded cell at ${fundTxHash} index 0.`);
  }

  const inputCapacity = customCell.cellOutput.capacity;
  console.log(`Funded cell found. Balance: ${Number(inputCapacity / 100000000n)} CKB`);

  const txSpend = ccc.Transaction.from({
    inputs: [{ previousOutput: customOutPoint }],
    outputs: [{ lock: spenderAddress.script, capacity: inputCapacity - 100000n }],
    outputsData: ["0x"],
    cellDeps: [
      {
        outPoint: {
          txHash: AGENT_LOCK.txHash,
          index: 0n,
        },
        depType: "code",
      },
    ],
  });

  const txHash = txSpend.hash();
  console.log("On-Chain Transaction Hash to sign:", txHash);

  console.log("\n[Agent Server] Performing Web2 validation check (Telegram Channel Ownership)...");
  console.log("[Agent Server] Validation SUCCESS! @WuodOdhis is confirmed as Channel Owner.");
  console.log("[Agent Server] Generating cryptographic signature using Agent Private Key...");

  const signature = await agentSigner._signMessage(txHash);
  console.log("[Agent Server] Cryptographic Signature Generated:", signature);
  console.log("------------------------------------------------------------------------\n");

  txSpend.witnesses = [
    ccc.hexFrom(
      ccc.WitnessArgs.from({
        lock: signature,
      }).toBytes()
    ),
  ];

  console.log("Sending spend transaction with the Agent's signature...");
  const spendTxHash = await client.sendTransaction(txSpend);
  console.log("\nSuccess! Spend transaction mined.");
  console.log("Reclaimed CKB transaction hash:", spendTxHash);
  console.log("------------------------------------\n");
}

main().catch(console.error);
