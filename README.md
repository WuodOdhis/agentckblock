# CKB Agent Lock

**A production-ready Web2-to-Web3 bridge for DAO communities.**

Unlock the power of Nervos CKB without your users ever touching a crypto wallet. Verify identity on Telegram, claim CKB on-chain - all secured by a custom RISC-V lock script running in CKB-VM.

---

## The Problem

DAOs want to reward their communities, but there's a massive UX gap:

1. **Seed phrases are hard** - Most Telegram community members have never used a crypto wallet
2. **Manual airdrops are tedious** - Sending tokens one-by-one doesn't scale
3. **Centralized custody is risky** - Trusting a single admin to hold and distribute funds introduces counterparty risk
4. **Gas fees kill micro-rewards** - Sending 100 people 5 CKB each costs more in fees than the reward itself

## The Solution

CKB Agent Lock lets DAOs **lock a reward pool on-chain** where each recipient's CKB is secured by a custom ECDSA lock script. Recipients prove their Telegram identity through a bot, and the Agent (a trusted server) signs the spend transaction - all without the end user needing to understand private keys, gas, or transaction construction.

### How It Works

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────┐
│   Admin     │────▶│  CKB Agent Lock  │────▶│   Devnet /   │
│  (DAO Ops)  │     │   Express API    │     │  CKB L1      │
└─────────────┘     └──────────────────┘     └──────────────┘
                           │                         ▲
                           ▼                         │
                    ┌──────────────┐     ┌──────────────┐
                    │   Telegram   │     │    Users     │
                    │     Bot      │────▶│ (Community)  │
                    └──────────────┘     └──────────────┘
```

1. **Admin** - Locks a CKB reward pool via the Admin Dashboard, specifying which Telegram usernames are eligible (pro-rata split)
2. **Users** - Visit the Claim Portal, enter their Telegram username and CKB address
3. **Verification** - The portal generates a challenge code; the user sends it to the Telegram bot to prove identity
4. **Claim** - The Agent server builds, signs, and broadcasts the CKB spend transaction using ECDSA signature recovery - executed directly on the CKB-VM

## Why CKB?

| Feature | CKB Agent Lock | Traditional Airdrop |
|---------|---------------|-------------------|
| **Self-custody** | Funds are locked on-chain, visible and verifiable by anyone | Funds sit in a multisig or admin wallet |
| **No seed phrases** | Users verify via Telegram (WebAuthn-ready) | Users must generate/manage keys |
| **1 CKB = 1 Byte** | Cells pay for their own storage, rent is reclaimable | Storage is external and opague |
| **RISC-V scripts** | Custom lock logic runs in hardware-standard VM | Limited to precompiles or Solidity |
| **Batch efficiency** | One tx locks N cells; N individual claims | N individual send transactions |

## Architecture

### On-Chain: Agent Lock Script (`contract/src/main.rs`)

A `#![no_std]` Rust binary compiled to RISC-V that runs in CKB-VM v2 (`data2`). The script:

1. Reads the lock script `args` - the trusted Agent's Blake160 public key hash
2. Reads the witness `lock` field - a 65-byte ECDSA signature (64 bytes + 1 recovery ID)
3. Loads the transaction hash via `load_tx_hash()`
4. Recovers the signer's public key using `k256::ecdsa::VerifyingKey::recover_from_prehash`
5. Hashes the recovered key with Blake2b (CKB default) and trims to 20 bytes (Blake160)
6. Compares against the expected hash in `args` - match = authorized

**Key technical achievement:** Successfully stripped RISC-V atomic instructions (`lr.d.aq`, `sc.d`) by compiling with `-C target-feature=-a`, enabling `ckb-std` and `k256` to run without hardware atomic support.

### Off-Chain: Express API + Dual UI

| Component | Tech | Purpose |
|-----------|------|---------|
| **Server** | Express + CCC SDK | Builds & broadcasts CKB transactions, manages challenges |
| **Admin UI** | Static HTML/CSS/JS | Lock reward pools, monitor claim status, see remaining balance |
| **User Portal** | Static HTML/CSS/JS | Generate challenge codes, verify via Telegram, claim CKB |
| **Telegram Bot** | Long-polling | Listens for `/verify <code>` messages, confirms identity |

## Getting Started

### Prerequisites

- Node.js 20+
- [OffCKB](https://github.com/RetricSu/offckb) for local devnet (`npm i -g offckb`)
- A Telegram bot token from [@BotFather](https://t.me/BotFather)

### Setup

```bash
# 1. Start a local CKB devnet
offckb node

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env with your Telegram bot token

# 4. Deploy the agent-lock script to devnet
npm run deploy
# Copy the output code_hash/hash_type/txHash into config.ts

# 5. Start the server
npm start
```

### Deploying the Contract

```bash
cd contract
make build        # Compile Rust to RISC-V binary
cd ..
npm run deploy    # Deploy binary to CKB devnet
```

### Two Interfaces

| Page | URL | Who |
|------|-----|-----|
| **Admin Dashboard** | `http://localhost:3000/admin.html` | DAO operators locking reward pools |
| **User Claim Portal** | `http://localhost:3000/portal.html` | Community members claiming rewards |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/admin/lock` | Lock CKB reward pool for N Telegram users |
| `GET` | `/api/admin/status` | Pool state: claimed vs pending, remaining balance |
| `POST` | `/api/challenge` | Generate a verification challenge code |
| `GET` | `/api/status?code=X` | Poll challenge verification status |
| `POST` | `/api/user/claim` | Build, sign, and broadcast claim transaction |

## The Technology

- **CKB-VM** - RISC-V based virtual machine running custom lock scripts
- **CCC SDK** - Canonical CKB Client for TypeScript transaction construction
- **k256** - Pure-Rust secp256k1 ECDSA signature recovery (no_std)
- **Blake2b** - CKB's native hashing (blake160 = first 20 bytes of Blake2b-256)
- **OffCKB** - Local PoW devnet for development and testing

## Roadmap

- [x] Custom ECDSA signature-recovery lock script
- [x] Web2-to-Web3 claim portal with Telegram verification
- [x] Admin dashboard with real-time claim tracking
- [ ] JoyID/WebAuthn integration (no server-side agent needed)
- [ ] Mainnet deployment guide and verified script hash
- [ ] xUDT token rewards (not just CKB)
- [ ] Multi-pool management and historical reporting

## Why DAOs Need This

> *"The next million CKB users won't come from seed phrases - they'll come from Telegram."*

CKB Agent Lock turns any Telegram community into a CKB-ready audience. No browser extensions, no seed phrase backups, no gas fees to figure out. Just a username, a bot, and a claim button.
