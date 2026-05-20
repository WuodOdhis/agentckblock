import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { ccc } from "@ckb-ccc/core";
import { createDevnetClient, AGENT_LOCK } from "./config.js";

dotenv.config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const AGENT_PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY;
const PRIMARY_WALLET_PRIVATE_KEY = process.env.PRIMARY_WALLET_PRIVATE_KEY;
const PORT = process.env.PORT || 3000;

if (!BOT_TOKEN || !AGENT_PRIVATE_KEY || !PRIMARY_WALLET_PRIVATE_KEY) {
  console.error("Error: TELEGRAM_BOT_TOKEN, AGENT_PRIVATE_KEY, and PRIMARY_WALLET_PRIVATE_KEY must be provided in .env");
  process.exit(1);
}

const client = createDevnetClient();

const spenderSigner = new ccc.SignerCkbPrivateKey(client, PRIMARY_WALLET_PRIVATE_KEY);
const agentSigner = new ccc.SignerCkbPrivateKey(client, AGENT_PRIVATE_KEY);

interface Challenge {
  username: string;
  verified: boolean;
  expiresAt: number;
}
const activeChallenges = new Map<string, Challenge>();

interface PoolRecipient {
  username: string;
  claimed: boolean;
}
interface Pool {
  id: string;
  txHash: string;
  totalAmount: bigint;
  perUser: bigint;
  recipients: PoolRecipient[];
  createdAt: number;
}
let currentPool: Pool | null = null;
const claimedOutPoints = new Set<string>();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(new URL(".", import.meta.url).pathname));

async function getAgentLockScript() {
  const agentAddress = await agentSigner.getRecommendedAddressObj();
  const agentPubKeyHash = agentAddress.script.args;
  return ccc.Script.from({
    codeHash: AGENT_LOCK.codeHash,
    hashType: AGENT_LOCK.hashType,
    args: agentPubKeyHash,
  });
}

// 1. ADMIN LOCK: Fund agent-locked cells with pro-rata CKB allocation
app.post("/api/admin/lock", async (req, res) => {
  const { rewardPool, usernames } = req.body;
  if (!rewardPool || !usernames || !Array.isArray(usernames) || usernames.length === 0) {
    res.status(400).json({ error: "rewardPool and a non-empty usernames list are required" });
    return;
  }

  try {
    const cleanUsernames = usernames.map(u => u.trim().replace(/^@/, "").toLowerCase());
    const count = cleanUsernames.length;
    const proRataAmount = BigInt(Math.floor(rewardPool / count));

    console.log(`[Agent Server] Locking ${rewardPool} CKB. Allocating ${proRataAmount} CKB pro-rata per user.`);

    const customLock = await getAgentLockScript();

    const tx = ccc.Transaction.from({
      outputs: cleanUsernames.map(() => ({
        lock: customLock,
        capacity: proRataAmount * 100000000n,
      })),
      outputsData: cleanUsernames.map(u => ccc.hexFrom(Buffer.from(u, "utf8"))),
    });

    console.log("[Agent Server] Completing inputs and fee for lock transaction...");
    await tx.completeInputsByCapacity(spenderSigner);
    await tx.completeFeeBy(spenderSigner, 1000n);

    console.log("[Agent Server] Signing and broadcasting lock transaction...");
    const txHash = await spenderSigner.sendTransaction(tx);
    console.log(`[Agent Server] Lock transaction successfully broadcasted! Hash: ${txHash}`);

    currentPool = {
      id: Date.now().toString(36),
      txHash,
      totalAmount: BigInt(rewardPool) * 100000000n,
      perUser: proRataAmount * 100000000n,
      recipients: cleanUsernames.map(u => ({ username: u, claimed: false })),
      createdAt: Date.now(),
    };

    res.json({ txHash, allocation: proRataAmount.toString(), poolId: currentPool.id });
  } catch (err: any) {
    console.error("[Agent Server] Error in /api/admin/lock:", err);
    res.status(500).json({ error: err.message || "Failed to construct and broadcast CKB lock transaction" });
  }
});

// 2. Register a new verification challenge for a user
app.post("/api/challenge", (req, res) => {
  const { username } = req.body;
  if (!username) {
    res.status(400).json({ error: "username is required" });
    return;
  }

  const cleanUsername = username.replace(/^@/, "").toLowerCase();
  const code = Math.floor(100000 + Math.random() * 900000).toString();

  activeChallenges.set(code, {
    username: cleanUsername,
    verified: false,
    expiresAt: Date.now() + 5 * 60 * 1000,
  });

  console.log(`[Agent Server] Challenge code ${code} generated for Telegram username @${cleanUsername}`);
  res.json({ code });
});

// 3. Check verification status
app.get("/api/status", (req, res) => {
  const { code } = req.query;
  if (!code || typeof code !== "string") {
    res.status(400).json({ error: "code parameter is required" });
    return;
  }

  const challenge = activeChallenges.get(code);
  if (!challenge) {
    res.json({ verified: false, error: "Invalid or expired challenge code" });
    return;
  }

  if (Date.now() > challenge.expiresAt) {
    activeChallenges.delete(code);
    res.json({ verified: false, error: "Challenge code expired" });
    return;
  }

  res.json({ verified: challenge.verified });
});

// 4. USER CLAIM: Spend agent-locked cell using agent-generated signature
app.post("/api/user/claim", async (req, res) => {
  const { code, destinationAddress } = req.body;
  if (!code || !destinationAddress) {
    res.status(400).json({ error: "code and destinationAddress are required" });
    return;
  }

  const challenge = activeChallenges.get(code);
  if (!challenge) {
    res.status(404).json({ error: "Challenge code not found or expired" });
    return;
  }

  if (!challenge.verified) {
    res.status(403).json({ error: "Challenge code has not been verified on Telegram yet!" });
    return;
  }

  try {
    const username = challenge.username;
    console.log(`[Agent Server] Challenge verified! Locating on-chain cell for Telegram user @${username}...`);

    const customLock = await getAgentLockScript();
    let targetCell = null;

    for await (const cell of client.findCells({ script: customLock, scriptType: "lock" })) {
      if (cell.outputData) {
        try {
          const cellUsername = Buffer.from(ccc.bytesFrom(cell.outputData)).toString("utf8").trim().toLowerCase();
          if (cellUsername === username) {
            targetCell = cell;
            break;
          }
        } catch (_) {}
      }
    }

    if (!targetCell) {
      res.status(404).json({ error: `Could not find any locked CKB cells for Telegram username @${username} on-chain!` });
      return;
    }

    console.log(`[Agent Server] Found Cell! Tx Hash: ${targetCell.outPoint.txHash}, capacity: ${targetCell.cellOutput.capacity} Shannons`);

    const targetAddress = await ccc.Address.fromString(destinationAddress, client);

    const txSpend = ccc.Transaction.from({
      inputs: [{ previousOutput: targetCell.outPoint }],
      outputs: [{ lock: targetAddress.script, capacity: targetCell.cellOutput.capacity - 100000n }],
      outputsData: ["0x"],
      cellDeps: [{
        outPoint: {
          txHash: AGENT_LOCK.txHash,
          index: 0n,
        },
        depType: "code",
      }],
    });

    const txHash = txSpend.hash();
    console.log(`[Agent Server] Constructed CKB spend transaction. Hash to sign: ${txHash}`);

    console.log("[Agent Server] Generating Agent signature over transaction hash...");
    const signature = await agentSigner._signMessage(txHash);

    txSpend.witnesses = [
      ccc.hexFrom(
        ccc.WitnessArgs.from({
          lock: signature,
        }).toBytes()
      ),
    ];

    console.log("[Agent Server] Broadcasting verified spend transaction to CKB Devnet...");
    const spendTxHash = await client.sendTransaction(txSpend);

    console.log(`[Agent Server] SUCCESS! Spend transaction mined! Reclaimed Hash: ${spendTxHash}`);

    activeChallenges.delete(code);

    if (currentPool) {
      const r = currentPool.recipients.find(r => r.username === username);
      if (r) r.claimed = true;
    }

    res.json({ txHash: spendTxHash, amountClaimed: (targetCell.cellOutput.capacity - 100000n).toString() });
  } catch (err: any) {
    console.error("[Agent Server] Error in /api/user/claim:", err);
    res.status(500).json({ error: err.message || "Failed to construct, sign, and broadcast CKB claim transaction" });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

app.get("/api/admin/status", (req, res) => {
  if (!currentPool) {
    res.json({ hasPool: false, message: "No active pool. Lock a reward pool first." });
    return;
  }

  const totalClaimed = currentPool.recipients.filter(r => r.claimed).length;
  const claimedAmount = totalClaimed * Number(currentPool.perUser);
  const remainingAmount = Number(currentPool.totalAmount) - claimedAmount;
  const remainingUsers = currentPool.recipients.length - totalClaimed;

  res.json({
    hasPool: true,
    totalAmount: currentPool.totalAmount.toString(),
    perUser: currentPool.perUser.toString(),
    remainingAmount: remainingAmount.toString(),
    txHash: currentPool.txHash,
    recipients: currentPool.recipients,
    stats: {
      total: currentPool.recipients.length,
      claimed: totalClaimed,
      pending: remainingUsers,
    },
  });
});

app.listen(PORT, () => {
  console.log(`[Agent Server] API listening on http://localhost:${PORT}`);
});

// Telegram Bot long-polling loop
async function pollTelegramUpdates() {
  let offset = 0;
  console.log("[Agent Server] Starting Telegram Bot Long-Polling Loop...");

  while (true) {
    try {
      const url = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${offset}&timeout=30`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Telegram API responded with status ${response.status}`);
      }

      const data = await response.json();
      if (data.ok && data.result.length > 0) {
        for (const update of data.result) {
          offset = update.update_id + 1;

          const message = update.message;
          if (message && message.text) {
            const text = message.text.trim();
            const from = message.from;
            const username = from?.username?.toLowerCase();

            if (!username) {
              continue;
            }

            console.log(`[Telegram Bot] Received message from @${username}: "${text}"`);

            const codeMatch = text.match(/(?:\/verify\s+)?(\d{6})/);
            if (codeMatch) {
              const code = codeMatch[1];
              const challenge = activeChallenges.get(code);

              if (challenge) {
                if (challenge.username === username) {
                  challenge.verified = true;
                  console.log(`[Telegram Bot] SUCCESS: @${username} verified ownership of challenge code ${code}!`);

                  const replyUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
                  await fetch(replyUrl, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      chat_id: message.chat.id,
                      text: "✅ Verification SUCCESS! Your CKB transaction signature has been generated. You can now unlock your CKB on the Web Portal!",
                    }),
                  });
                } else {
                  console.log(`[Telegram Bot] FAILED: Code ${code} matches username @${challenge.username}, but message was sent by @${username}`);

                  const replyUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
                  await fetch(replyUrl, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      chat_id: message.chat.id,
                      text: "❌ Verification FAILED: This code is registered to another Telegram user.",
                    }),
                  });
                }
              } else {
                console.log(`[Telegram Bot] Code ${code} is invalid or has expired.`);
                const replyUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
                await fetch(replyUrl, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    chat_id: message.chat.id,
                    text: "❌ Verification FAILED: The code is invalid or has expired. Please check the Web Portal.",
                  }),
                });
              }
            }
          }
        }
      }
    } catch (error: any) {
      if (error && typeof error.message === "string" && error.message.includes('409')) {
        console.warn('[Agent Server] Telegram 409 Conflict – another instance may be polling. Back-off 5s and continue.');
      } else {
        console.error('[Agent Server] Unexpected error in Telegram long polling loop:', error);
      }
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

pollTelegramUpdates().catch((err) => {
  console.error('Fatal error in Telegram Polling loop:', err);
});
