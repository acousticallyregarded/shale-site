// Shale rounds dashboard: account parsing and status derivation (no DOM, no network).
// Mirrors solana/core/src/layout.rs and solana/miner/src/status.rs; dashboard/status.test.mjs
// checks it against fixtures written by the Rust code.

export const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
export const TESTNET_GENESIS = "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY";

export const STATUS = { PAUSED: 0, ARMING: 1, OPEN: 2, ENDED: 3 };
export const OP_CLAIM_FINALIZE = 16;

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function b58encode(bytes) {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let s = "";
  while (n > 0n) {
    s = B58[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    s = "1" + s;
  }
  return s;
}

export function b58decode(s) {
  let n = 0n;
  for (const c of s) {
    const i = B58.indexOf(c);
    if (i < 0) throw new Error("invalid base58");
    n = n * 58n + BigInt(i);
  }
  const out = [];
  while (n > 0n) {
    out.unshift(Number(n % 256n));
    n /= 256n;
  }
  for (const c of s) {
    if (c !== "1") break;
    out.unshift(0);
  }
  return Uint8Array.from(out);
}

export function fromBase64(s) {
  if (typeof atob === "function") return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  return Uint8Array.from(Buffer.from(s, "base64"));
}

const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const u32 = (d, o) => (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16)) + d[o + 3] * 2 ** 24;
const u64 = (d, o) => BigInt(u32(d, o)) + (BigInt(u32(d, o + 4)) << 32n);
const key = (d, o) => b58encode(d.slice(o, o + 32));
const eq = (d, tag) => Array.from(tag).every((c, i) => d[i] === c.charCodeAt(0));

export function parseDeployment(d) {
  if (d.length !== 736 || !eq(d, "SHRdepl1")) return null;
  return {
    net: d[11], hc: d[14], decimals: d[15], tokenKind: d[18], flags: d[19],
    dataLayers: u32(d, 20), deploymentId: u64(d, 24), epoch: u64(d, 32), nl: u64(d, 40),
    bits: u32(d, 52), reward: u64(d, 56), timeout: u64(d, 64),
    pendingBits: u32(d, 72), pendingSet: u32(d, 76), pendingReward: u64(d, 80), pendingTimeout: u64(d, 88),
    pendingEffectiveSlot: u64(d, 96), seedDelay: u64(d, 104), paramDelay: u64(d, 112), recoveryDelay: u64(d, 120),
    maxReward: u64(d, 128), createdSlot: u64(d, 136), admin: key(d, 144), pendingAdmin: key(d, 176),
    mint: key(d, 208), vault: key(d, 240), tokenProgram: key(d, 272), capRoot: hex(d.slice(368, 400)),
    maxTarget: d.slice(656, 688), creator: key(d, 688), grace: u64(d, 720),
    recoveryEnabled: (d[19] & 1) !== 0, pauseRequested: (d[19] & 2) !== 0,
  };
}

export function parseRound(d) {
  if (d.length !== 2648 || !eq(d, "SHRround")) return null;
  const n = u32(d, 212);
  const next = u32(d, 208);
  const history = [];
  for (let k = 0; k < n; k++) {
    const i = (next + 16 - 1 - k) % 16;
    const o = 216 + 152 * i;
    history.push({
      roundId: u32(d, o), outcome: d[o + 4], winner: key(d, o + 8), recipient: key(d, o + 40),
      pow: hex(d.slice(o + 72, o + 104)), nonce: hex(d.slice(o + 104, o + 136)),
      completedSlot: u64(d, o + 136), reward: u64(d, o + 144),
    });
  }
  return {
    status: d[9], roundId: u32(d, 12), deployment: key(d, 16), challenge: hex(d.slice(48, 80)),
    bits: u32(d, 80), rearms: u32(d, 84), reward: u64(d, 88), seedSlot: u64(d, 96), seedHashSlot: u64(d, 104),
    openedSlot: u64(d, 112), deadlineSlot: u64(d, 120), totalPaid: u64(d, 160), roundsWon: u64(d, 168),
    roundsExpired: u64(d, 176), expiryArmedSlot: u64(d, 184), pausedSlot: u64(d, 200), history,
  };
}

export function parseStats(d) {
  if (d.length !== 72 || !eq(d, "SHRstats")) return null;
  return { totalFunded: u64(d, 48), totalRecovered: u64(d, 56), fundCount: u64(d, 64) };
}

/** The token amount of an SPL Token / Token-2022 account (bytes 64..72). */
export function tokenAmount(d) {
  return d && d.length >= 72 ? u64(d, 64) : 0n;
}

/** Mirrors status::derive_status (Rust). Slots are BigInt. */
export function deriveStatus(dep, r, vault, slot) {
  switch (r.status) {
    case STATUS.PAUSED: return "Paused";
    case STATUS.ENDED: return "Ended";
    case STATUS.ARMING: return slot > r.seedSlot ? "Arming, seed slot reached (anyone can open_round)" : "Arming";
    case STATUS.OPEN:
      if (vault < r.reward) return "Open, awaiting vault top-up";
      if (slot < r.deadlineSlot) return "Open";
      if (slot < r.deadlineSlot + dep.grace) return "Open, past deadline (grace window)";
      if (r.expiryArmedSlot === 0n) return "Open, expiry can be armed";
      if (slot < r.expiryArmedSlot + dep.grace) return "Open, expiry armed";
      return "Open, expirable";
    default: return `unknown status ${r.status}`;
  }
}

/** Expected Shale evaluations per solution for compact bits: 2^256 / (T + 1). */
export function expectedAttempts(bits) {
  const e = bits >>> 24;
  const m = bits & 0x7fffff;
  if (bits & 0x800000 || m === 0) return null;
  let t = e <= 3 ? BigInt(m >> (8 * (3 - e))) : BigInt(m) << BigInt(8 * (e - 3));
  if (t === 0n || t >= 1n << 256n) return null;
  return 2 ** 256 / (Number(t) + 1); // display only, as in the Rust (float)
}

export function expectedFromTarget(le32) {
  let t = 0n;
  for (let i = 31; i >= 0; i--) t = t * 256n + BigInt(le32[i]);
  return 2 ** 256 / (Number(t) + 1); // display only, as in the Rust (float)
}

/** The banner, tied to the cluster's genesis hash (review fix). */
export function clusterLabel(genesis, url) {
  if (genesis === DEVNET_GENESIS) return { cluster: "devnet", banner: "TEST TOKEN, NO VALUE", allowed: true };
  if (genesis === MAINNET_GENESIS || genesis === TESTNET_GENESIS) {
    return { cluster: genesis === MAINNET_GENESIS ? "mainnet" : "testnet", allowed: false,
      banner: "No real-token deployment exists. This page only describes test deployments on devnet or a local validator." };
  }
  const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/.test(url);
  if (local) return { cluster: "local validator", banner: "TEST TOKEN, NO VALUE", allowed: true };
  return { cluster: "unknown", banner: "Unknown cluster: not a known test deployment.", allowed: false };
}

/** Removes user info, path and query from an RPC URL for display. */
export function redactUrl(url) {
  const m = /^(https?):\/\/(?:[^@/?#]*@)?([^/?#]*)(.*)$/.exec(url);
  if (!m) return "<invalid url>";
  return `${m[1]}://${m[2]}${m[3] && m[3] !== "/" ? "/<redacted>" : ""}`;
}

/**
 * Whether a transaction may be shown as the link of a won history entry: it succeeded,
 * its slot is the entry's completed slot, and it has a top-level claim_finalize of this
 * program with the Round at account index 2 and the winner as account 0. Winners
 * themselves always come from the Round account, never from transactions or logs.
 */
export function acceptLink(tx, programId, roundAddr, entry) {
  if (!tx || !tx.meta || tx.meta.err !== null) return false;
  if (BigInt(tx.slot) !== entry.completedSlot) return false;
  const msg = tx.transaction.message;
  const keys = msg.accountKeys.map((k) => (typeof k === "string" ? k : k.pubkey));
  return msg.instructions.some((ix) => {
    if (keys[ix.programIdIndex] !== programId) return false;
    const data = b58decode(ix.data);
    if (data[0] !== OP_CLAIM_FINALIZE) return false;
    return keys[ix.accounts[2]] === roundAddr && keys[ix.accounts[0]] === entry.winner;
  });
}

export const LINK_PAGE_LIMIT = 100;
export const LINK_MAX_PAGES = 5;
