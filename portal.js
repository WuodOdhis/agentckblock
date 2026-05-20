// -------------------------------------------------------------
// Constants & Configuration
// -------------------------------------------------------------
const SERVER_URL = "http://localhost:3000";
let activePollInterval = null;
let currentChallengeCode = null;

// -------------------------------------------------------------
// DOM Elements
// -------------------------------------------------------------
const logContainer = document.getElementById("console-logs");
const btnClearConsole = document.getElementById("btn-clear-console");

const userTelegramInput = document.getElementById("user-telegram");
const userAddressInput = document.getElementById("user-address");
const btnCheckClaim = document.getElementById("btn-check-claim");

const challengeContainer = document.getElementById("challenge-container");
const challengeCodeBox = document.getElementById("challenge-code");
const verificationStatusEl = document.getElementById("verification-status");

const successContainer = document.getElementById("success-container");
const btnClaimFunds = document.getElementById("btn-claim-funds");

// -------------------------------------------------------------
// Log stream helper
// -------------------------------------------------------------
function logToConsole(message, type = "info") {
  const line = document.createElement("div");
  line.className = `log-line ${type}`;
  
  // Format timestamps
  const now = new Date();
  const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
  
  line.innerText = `[${timeStr}] ${message}`;
  logContainer.appendChild(line);
  logContainer.scrollTop = logContainer.scrollHeight;
}

btnClearConsole.addEventListener("click", () => {
  logContainer.innerHTML = "";
  logToConsole("Terminal logs cleared.");
});

// -------------------------------------------------------------
// 1. Check Eligibility & Challenge User
// -------------------------------------------------------------
btnCheckClaim.addEventListener("click", async () => {
  const username = userTelegramInput.value.trim().replace(/^@/, "").toLowerCase();
  const address = userAddressInput.value.trim();

  if (!username) {
    logToConsole("Error: Please enter your Telegram username.", "error");
    return;
  }
  if (!address) {
    logToConsole("Error: Please enter a destination CKB address.", "error");
    return;
  }

  logToConsole(`[Check] Checking payout eligibility for @${username} on CKB...`, "input");

  btnCheckClaim.disabled = true;
  btnCheckClaim.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Registering Challenge...`;

  try {
    const res = await fetch(`${SERVER_URL}/api/challenge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username })
    });

    if (!res.ok) {
      throw new Error(`Agent Server responded with status ${res.status}`);
    }

    const data = await res.json();
    currentChallengeCode = data.code;

    challengeCodeBox.innerText = `${currentChallengeCode.slice(0, 3)} ${currentChallengeCode.slice(3)}`;
    
    challengeContainer.classList.remove("hidden");
    successContainer.classList.add("hidden");

    logToConsole(`[Agent API] Challenge code generated: ${currentChallengeCode}.`, "success");
    logToConsole(`[Verification] Waiting for @${username} to send \`/verify ${currentChallengeCode}\` to @ckbagentbot...`, "info");

    startPollingStatus(currentChallengeCode);

  } catch (error) {
    console.error(error);
    logToConsole("Error: Failed to register challenge code on Agent server. Is server.ts running?", "error");
  } finally {
    btnCheckClaim.disabled = false;
    btnCheckClaim.innerHTML = `<i class="fa-solid fa-magnifying-glass"></i> Check Payout Eligibility`;
  }
});

// -------------------------------------------------------------
// 2. Polling Verification Status Loop
// -------------------------------------------------------------
function startPollingStatus(code) {
  if (activePollInterval) {
    clearInterval(activePollInterval);
  }

  activePollInterval = setInterval(async () => {
    try {
      const res = await fetch(`${SERVER_URL}/api/status?code=${code}`);
      const data = await res.json();

      if (data.error) {
        logToConsole(`[Verification] Polling error: ${data.error}`, "error");
        clearInterval(activePollInterval);
        return;
      }

      if (data.verified) {
        logToConsole(`[Verification] SUCCESS! Telegram Bot confirmed user sent the code!`, "success");
        clearInterval(activePollInterval);

        challengeContainer.classList.add("hidden");
        successContainer.classList.remove("hidden");
      }
    } catch (err) {
      console.error("Error polling verification status:", err);
    }
  }, 2000);
}

// -------------------------------------------------------------
// 3. Claim & Spend CKB Payout
// -------------------------------------------------------------
btnClaimFunds.addEventListener("click", async () => {
  const address = userAddressInput.value.trim();

  btnClaimFunds.disabled = true;
  btnClaimFunds.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Executing Real Claim Transaction...`;

  logToConsole(`[Claim] Requesting real on-chain claim transaction...`, "input");

  try {
    // Request the Express server to build, sign, and broadcast the real CKB spend transaction
    const res = await fetch(`${SERVER_URL}/api/user/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: currentChallengeCode, destinationAddress: address })
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "Failed to claim CKB");
    }

    const data = await res.json();
    const amountCkb = parseFloat(data.amountClaimed) / 100000000;

    logToConsole(`[CKB Node] Real Claim Transaction successfully broadcasted and mined!`, "success");
    logToConsole(`[On-Chain] Tx Hash: ${data.txHash}`, "success");
    logToConsole(`[On-Chain] Claimed capacity: ${amountCkb.toLocaleString()} CKB transferred directly to destination address!`, "success");
    logToConsole(`[Devnet] Verify this transaction using: ckb-cli rpc get_transaction --hash ${data.txHash}`, "info");

    // Confetti celebration!
    confetti({
      particleCount: 150,
      spread: 80,
      origin: { y: 0.6 }
    });

  } catch (error) {
    console.error(error);
    logToConsole(`Error claiming funds: ${error.message}`, "error");
  } finally {
    successContainer.classList.add("hidden");
    btnClaimFunds.disabled = false;
    btnClaimFunds.innerHTML = `<i class="fa-solid fa-circle-arrow-down"></i> Claim & Spend CKB`;
  }
});
