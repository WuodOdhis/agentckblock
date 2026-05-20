import { ccc } from "@ckb-ccc/core";

// OffCKB local devnet configuration
export const DEVNET_URL = "http://127.0.0.1:8114";

// OffCKB secp256k1 system script outpoint (devnet-specific)
export const SECP256K1_CELL_DEP = {
  cellDep: {
    outPoint: {
      txHash: "0x4d804f1495612631da202fe9902fa9899118554b08138cfe5dfb50e1ede76293",
      index: 0n,
    },
    depType: "depGroup" as const,
  },
};

// Deployed agent-lock script parameters
// ⚠ Update these after running deploy.ts to match your deployed binary
export const AGENT_LOCK = {
  codeHash: "0xd352ef2ab642c484ee3133f2adfb838b7dd256a59c2d3313e84e0d04658e9fe7",
  hashType: "data2" as const,
  txHash: "0x2dfac3f4822ec4123a09bb139f5f7032e0eda77256f7a18e6fa5dd20d09b3ad0",
};

// Devnet pre-funded accounts (from `offckb accounts`)
export const ACCOUNTS = {
  primary: "0x9f315d5a9618a39fdc487c7a67a8581d40b045bd7a42d83648ca80ef3b2cb4a1",   // #1 - admin/funder
  alice: "0x6109170b275a09ad54877b82f7d9930f88cab5717d484fb4741ae9d1dd078cd6",     // #0 - user/recipient
  agent: "0x59ddda57ba06d6e9c5fa9040bdb98b4b098c2fce6520d39f51bc5e825364697a",    // #2 - agent (signs txns)
};

export function createDevnetClient(scripts?: Record<string, unknown>) {
  const dummyClient = new ccc.ClientPublicTestnet({ url: DEVNET_URL });
  const myScripts = { ...dummyClient.scripts };

  myScripts[ccc.KnownScript.Secp256k1Blake160] = {
    cellDeps: [SECP256K1_CELL_DEP],
    codeHash: "0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8",
    hashType: "type",
  };

  return new ccc.ClientPublicTestnet({ url: DEVNET_URL, scripts: { ...myScripts, ...scripts } });
}
