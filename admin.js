const SERVER_URL = "http://localhost:3000";

const logContainer = document.getElementById("console-logs");
const btnClearConsole = document.getElementById("btn-clear-console");
const rewardPoolInput = document.getElementById("reward-pool");
const adminUsernamesInput = document.getElementById("admin-usernames");
const userCountEl = document.getElementById("user-count");
const proRataValEl = document.getElementById("pro-rata-val");
const btnLockPool = document.getElementById("btn-lock-pool");
const poolEmpty = document.getElementById("pool-empty-state");
const poolContent = document.getElementById("pool-status-content");
const totalLockedEl = document.getElementById("total-locked");
const claimedCountEl = document.getElementById("claimed-count");
const pendingCountEl = document.getElementById("pending-count");
const remainingAmountEl = document.getElementById("remaining-amount");
const recipientsListEl = document.getElementById("recipients-list");

function log(message, type = "info") {
  const line = document.createElement("div");
  line.className = `log-line ${type}`;
  const now = new Date();
  const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
  line.innerText = `[${timeStr}] ${message}`;
  logContainer.appendChild(line);
  logContainer.scrollTop = logContainer.scrollHeight;
}

btnClearConsole.addEventListener("click", () => {
  logContainer.innerHTML = "";
  log("Terminal logs cleared.");
});

function updateProRata() {
  const poolAmount = parseFloat(rewardPoolInput.value) || 0;
  const lines = adminUsernamesInput.value.split("\n");
  const usernames = lines
    .map(line => line.trim().replace(/^@/, "").toLowerCase())
    .filter(name => name.length > 0);
  const count = usernames.length;
  userCountEl.innerText = `${count} Users`;
  if (count === 0) {
    proRataValEl.innerText = "0 CKB / user";
    return;
  }
  const proRata = Math.floor(poolAmount / count);
  proRataValEl.innerText = `${proRata.toLocaleString()} CKB / user`;
}

rewardPoolInput.addEventListener("input", updateProRata);
adminUsernamesInput.addEventListener("input", updateProRata);
updateProRata();

btnLockPool.addEventListener("click", async () => {
  const poolAmount = parseFloat(rewardPoolInput.value) || 0;
  const lines = adminUsernamesInput.value.split("\n");
  const usernames = lines
    .map(line => line.trim().replace(/^@/, "").toLowerCase())
    .filter(name => name.length > 0);

  if (poolAmount <= 0 || usernames.length === 0) {
    log("Error: Enter a valid amount and at least one username.", "error");
    return;
  }

  btnLockPool.disabled = true;
  btnLockPool.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Locking CKB On-Chain...`;
  log(`[Admin] Requesting lock transaction for ${poolAmount} CKB...`, "input");

  try {
    const res = await fetch(`${SERVER_URL}/api/admin/lock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rewardPool: poolAmount, usernames })
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "Failed to lock pool");
    }

    const data = await res.json();
    log(`[CKB] Lock transaction broadcasted! Tx: ${data.txHash}`, "success");
    log(`[Pool] ${usernames.length} cells created with ${data.allocation} CKB each.`, "success");
    log(`[Pool] Pool ID: ${data.poolId}`, "info");

    await fetchStatus();
  } catch (error) {
    log(`Error: ${error.message}`, "error");
  } finally {
    btnLockPool.disabled = false;
    btnLockPool.innerHTML = `<i class="fa-solid fa-lock"></i> Lock CKB Reward Pool`;
  }
});

async function fetchStatus() {
  try {
    const res = await fetch(`${SERVER_URL}/api/admin/status`);
    const data = await res.json();

    if (!data.hasPool) {
      poolEmpty.classList.remove("hidden");
      poolContent.classList.add("hidden");
      return;
    }

    poolEmpty.classList.add("hidden");
    poolContent.classList.remove("hidden");

    const totalCkb = (Number(data.totalAmount) / 100000000).toLocaleString();
    totalLockedEl.textContent = totalCkb;

    claimedCountEl.textContent = data.stats.claimed;
    pendingCountEl.textContent = data.stats.pending;

    const remainingCkb = (Number(data.remainingAmount) / 100000000).toLocaleString();
    remainingAmountEl.textContent = `${remainingCkb} CKB`;

    recipientsListEl.innerHTML = data.recipients.map(r => {
      const statusClass = r.claimed ? "success" : "warn";
      const icon = r.claimed ? "fa-circle-check" : "fa-clock";
      const label = r.claimed ? "Claimed" : "Pending";
      return `<div style="display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.02); border:1px solid var(--panel-border); border-radius:10px; padding:0.8rem 1rem;">
        <span><i class="fa-brands fa-telegram" style="margin-right:0.5rem; color:#0088cc;"></i>@${r.username}</span>
        <span class="log-line ${statusClass}"><i class="fa-solid ${icon}"></i> ${label}</span>
      </div>`;
    }).join("");
  } catch (error) {
    log(`Status fetch failed: ${error.message}`, "error");
  }
}

setInterval(fetchStatus, 5000);
fetchStatus();
