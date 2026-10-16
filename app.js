// Live round data from Solana devnet and the wallet panel.
import { parseDeployment, parseRound, parseRewards, tokenAmount, deriveStatus, expectedAttempts, fromBase64, STATUS, OP_WITHDRAW } from "./lib/status.js";

const RPC = "https://api.devnet.solana.com";
const IDS = {
  program: "5XVwNCE51g6fjbjbt9GGk11wLqPaxLojKDGK3qV1o9yn",
  deployment: "3mmCZ5tsdmiZyBLUznxk5sE8jwjhhGHgFm9ATjtPktgD",
  round: "D5dF43kMCmcmuupYUubQkRvK3H84J8zHAnrLGffVYn48",
  vault: "2C6JQxxv8ZqkrSGqCT427T2FfoSafY2apWLqw9qbXGhp",
  mint: "7k2R41gVNxLgx2KDLEGEN4cJ99xTeE5ZtfBQ7acAhkP6",
};
const DECIMALS = 6;
const explorer = (a) => `https://explorer.solana.com/address/${a}?cluster=devnet`;
const $ = (id) => document.getElementById(id);

// ---------- mascot facts ----------
const FACTS = [
  "Every two weeks the network builds a 6 GiB dataset in layers, like rock.",
  "One mining attempt makes 32 random hops through memory.",
  "Memory speed is the bottleneck, so custom chips gain little over a GPU.",
  "The dataset can only be built in order. No shortcuts, no light evaluation.",
  "Each block carries a 10 KiB receipt of the memory it read.",
  "The Solana program checks every proof on-chain with the miner's own code.",
  "Your key is part of the work, so nobody can steal your win by copying it.",
  "Designed by AI agents, attacked by AI critics, checked by AI auditors.",
  "Devnet Shale is a test token. It has no value. Mine it for fun.",
];
let fact = 0;
const stage = $("golem-stage");
if (stage) {
  import("./mascot3d.js")
    .then(({ mountMascot }) => mountMascot(stage, {
      golemUrl: "assets/3d/golem5.animated.glb",
      onHit: () => { $("speech").textContent = FACTS[fact++ % FACTS.length]; },
    }))
    .catch(() => { $("speech").textContent = "Shaly could not load here. Try another browser."; });
}

// ---------- logo ----------
(function logo() {
  const c = $("logo").getContext("2d");
  const rows = ["...hhhhhh.......", "..hhhhhhhh......", ".rrrrrrrrrrr....", "rRRRRRRRRRRRr...", "rRwwRRRRwwRRr...", "rRwkRRRRwkRRr...", "rggggggggggggr..", "rRRRRmmmmRRRRr..", "rssssssssssssr..", ".rrrrrrrrrrrr..."];
  const pal = { h: "#f2c230", r: "#2b3238", R: "#7d8a93", w: "#fff", k: "#20252b", g: "#e2b443", m: "#c7d0d6", s: "#6a7680" };
  rows.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== ".") { c.fillStyle = pal[ch]; c.fillRect(x, y + 3, 1, 1); } }));
})();

// ---------- copy contract address ----------
$("copy-mint").addEventListener("click", async () => {
  const text = $("mint-addr").textContent.trim();
  try { await navigator.clipboard.writeText(text); $("copy-mint").textContent = "Copied"; }
  catch { const r = document.createRange(); r.selectNodeContents($("mint-addr")); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
  setTimeout(() => ($("copy-mint").textContent = "Copy"), 1500);
});

// ---------- RPC ----------
async function rpc(method, params) {
  const res = await fetch(RPC, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  if (!res.ok) throw new Error(`RPC ${res.status}`);
  const j = await res.json();
  if (j.error) throw new Error(j.error.message || "RPC error");
  return j.result;
}

const fmtTokens = (base) => {
  const whole = base / 10n ** BigInt(DECIMALS);
  return whole.toLocaleString("en-US");
};
const fmtAttempts = (n) => (n == null ? "–" : n >= 1e9 ? (n / 1e9).toFixed(1) + "B" : n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : String(Math.round(n)));
const short = (a) => a.slice(0, 4) + "…" + a.slice(-4);

let lastRound = null;
let lastDep = null;

async function refresh() {
  try {
    const [accs, slot] = await Promise.all([
      rpc("getMultipleAccounts", [[IDS.deployment, IDS.round, IDS.vault], { encoding: "base64", commitment: "confirmed" }]),
      rpc("getSlot", [{ commitment: "confirmed" }]),
    ]);
    const data = accs.value.map((a) => (a ? fromBase64(a.data[0]) : null));
    const dep = data[0] && parseDeployment(data[0]);
    const r = data[1] && parseRound(data[1]);
    const vault = tokenAmount(data[2]);
    if (!dep || !r) throw new Error("accounts not found");
    lastRound = r;
    lastDep = dep;
    const status = deriveStatus(dep, r, vault, BigInt(slot));
    const open = r.status === STATUS.OPEN && !status.includes("awaiting");
    $("v-round").textContent = `#${r.roundId}`;
    $("v-status").textContent = status.split(",")[0];
    $("v-status").className = "status-pill " + (open ? "open" : "wait");
    $("v-reward").textContent = fmtTokens(r.reward || dep.reward);
    $("v-diff").textContent = fmtAttempts(expectedAttempts(r.bits || dep.bits));
    // Rewards credited and not yet claimed stay in the vault for their winners.
    const owed = r.outstanding ?? 0n;
    $("v-vault").textContent = fmtTokens(vault > owed ? vault - owed : 0n);
    $("v-vault-sub").textContent = owed > 0n ? `tokens left to win (${fmtTokens(owed)} more wait to be claimed)` : "tokens left to win";
    $("v-paid").textContent = fmtTokens(r.totalPaid);
    $("v-won").textContent = `${r.roundsWon} rounds won`;
    $("v-challenge").textContent = r.status === STATUS.OPEN ? r.challenge : "next challenge appears when the round opens";
    $("bubble-round").textContent = `round #${r.roundId} · ${status.split(",")[0].toLowerCase()}`;
    const list = $("winners");
    list.replaceChildren();
    const wins = r.history.filter((h) => h.reward > 0n);
    if (!wins.length) {
      const e = document.createElement("div"); e.className = "empty"; e.textContent = "No winners yet. Be the first."; list.append(e);
    }
    for (const h of wins.slice(0, 8)) {
      const row = document.createElement("div"); row.className = "winner";
      const rd = document.createElement("span"); rd.className = "round"; rd.textContent = `#${h.roundId}`;
      const who = document.createElement("a"); who.className = "who"; who.href = explorer(h.winner); who.rel = "noopener"; who.textContent = h.winner;
      const amt = document.createElement("span"); amt.className = "amt"; amt.textContent = `+${fmtTokens(h.reward)} Shale`;
      row.append(rd, who, amt); list.append(row);
    }
    $("v-updated").textContent = `Updated at slot ${slot.toLocaleString("en-US")} · refreshes every 20 s`;
    if (wallet && !busy) updateWallet(true); // balances only; keeps the claim message
  } catch (e) {
    $("v-updated").textContent = `Could not reach Solana devnet (${e.message}). Retrying…`;
  }
}
refresh();
setInterval(refresh, 20000);

// ---------- wallet and claiming ----------
// Wins are credited on-chain to the payout wallet's Rewards account
// (PDA ["rewards", deployment, payout] of the program). Claim sends one transaction:
// an idempotent create of the wallet's Token-2022 account for the mint, then the
// program's `withdraw`, which pays everything credited. The wallet signs; this page
// never sees or asks for a private key.
const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const txLink = (s) => `https://explorer.solana.com/tx/${s}?cluster=devnet`;
// Program errors a withdrawal can meet (solana/core/src/errors.rs).
const PROGRAM_ERRORS = {
  6004: "This wallet is not the payout of that balance.",
  6024: "The destination is not this wallet's Shale token account.",
  6025: "This wallet's Shale token account requires memos; turn that off in the wallet and try again.",
  6040: "Nothing to claim yet.",
};

function provider() {
  if (window.phantom?.solana?.isPhantom) return window.phantom.solana;
  if (window.solflare?.isSolflare) return window.solflare;
  if (window.backpack?.isBackpack) return window.backpack;
  if (window.solana) return window.solana;
  return null;
}
let wallet = null;
let owed = 0n;
let busy = false;

function say(text, cls = "msg") {
  $("c-msg").className = cls;
  $("c-msg").replaceChildren(text);
}

/** Says `text`, then a link (built with DOM nodes, never HTML strings). */
function sayLink(text, href, label, cls = "msg ok") {
  const a = document.createElement("a");
  a.href = href;
  a.rel = "noopener";
  a.target = "_blank";
  a.textContent = label;
  $("c-msg").className = cls;
  $("c-msg").replaceChildren(text, " ", a);
}

/** Every address the claim needs, derived here from the program's seeds. */
function claimAddresses(owner) {
  const { PublicKey } = window.solanaWeb3;
  const enc = new TextEncoder();
  const program = new PublicKey(IDS.program);
  const deployment = new PublicKey(IDS.deployment);
  const mint = new PublicKey(IDS.mint);
  const tokenProgram = new PublicKey(lastDep?.tokenProgram || TOKEN_2022);
  const ownerKey = new PublicKey(owner);
  const [rewards] = PublicKey.findProgramAddressSync([enc.encode("rewards"), deployment.toBytes(), ownerKey.toBytes()], program);
  const [vaultAuthority] = PublicKey.findProgramAddressSync([enc.encode("vault"), deployment.toBytes()], program);
  const ataProgram = new PublicKey(ATA_PROGRAM);
  const [destination] = PublicKey.findProgramAddressSync([ownerKey.toBytes(), tokenProgram.toBytes(), mint.toBytes()], ataProgram);
  const [vault] = PublicKey.findProgramAddressSync([vaultAuthority.toBytes(), tokenProgram.toBytes(), mint.toBytes()], ataProgram);
  // The derivation must give the live deployment's vault, or nothing is sent.
  if (vault.toBase58() !== IDS.vault) throw new Error("the derived vault does not match the deployment");
  return { program, deployment, round: new PublicKey(IDS.round), mint, tokenProgram, owner: ownerKey, rewards, vaultAuthority, vault, destination, ataProgram };
}

/** The claim transaction: create the token account if missing, then withdraw. */
async function buildClaim(owner) {
  const { PublicKey, Transaction, TransactionInstruction } = window.solanaWeb3;
  const k = claimAddresses(owner);
  const createAta = new TransactionInstruction({
    programId: k.ataProgram,
    keys: [
      { pubkey: k.owner, isSigner: true, isWritable: true },
      { pubkey: k.destination, isSigner: false, isWritable: true },
      { pubkey: k.owner, isSigner: false, isWritable: false },
      { pubkey: k.mint, isSigner: false, isWritable: false },
      { pubkey: new PublicKey(SYSTEM_PROGRAM), isSigner: false, isWritable: false },
      { pubkey: k.tokenProgram, isSigner: false, isWritable: false },
    ],
    data: Uint8Array.of(1), // CreateIdempotent
  });
  // withdraw: [owner (s), deployment, round (w), rewards (w), mint, vault (w), vault_authority, destination (w), token_program]
  const withdraw = new TransactionInstruction({
    programId: k.program,
    keys: [
      { pubkey: k.owner, isSigner: true, isWritable: false },
      { pubkey: k.deployment, isSigner: false, isWritable: false },
      { pubkey: k.round, isSigner: false, isWritable: true },
      { pubkey: k.rewards, isSigner: false, isWritable: true },
      { pubkey: k.mint, isSigner: false, isWritable: false },
      { pubkey: k.vault, isSigner: false, isWritable: true },
      { pubkey: k.vaultAuthority, isSigner: false, isWritable: false },
      { pubkey: k.destination, isSigner: false, isWritable: true },
      { pubkey: k.tokenProgram, isSigner: false, isWritable: false },
    ],
    data: Uint8Array.of(OP_WITHDRAW),
  });
  const { blockhash, lastValidBlockHeight } = (await rpc("getLatestBlockhash", [{ commitment: "confirmed" }])).value;
  const tx = new Transaction({ feePayer: k.owner, blockhash, lastValidBlockHeight });
  tx.add(createAta, withdraw);
  return { tx, lastValidBlockHeight, k };
}

const toB64 = (bytes) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};

/** A readable reason for a failed simulation or transaction. */
function reason(err) {
  if (!err) return "";
  if (err === "AccountNotFound" || err === "InsufficientFundsForFee" || err === "InsufficientFundsForRent")
    return "This wallet needs a little devnet SOL for the fee (and, the first time, its token account). Get some at faucet.solana.com (choose Devnet).";
  const ie = err.InstructionError;
  if (ie) {
    const code = ie[1]?.Custom;
    if (code != null && ie[0] === 1) return PROGRAM_ERRORS[code] || `The program refused the claim (error ${code}).`;
    if (ie[1] === "InsufficientFunds" || code === 1) return "This wallet needs a little devnet SOL for its token account. Get some at faucet.solana.com (choose Devnet).";
    return `The claim failed (${JSON.stringify(ie[1])}).`;
  }
  return `The claim failed (${JSON.stringify(err)}).`;
}

/** Simulates the unsigned claim on devnet (no signature, no wallet involved). */
async function simulate(tx) {
  const raw = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  const res = await rpc("simulateTransaction", [toB64(raw), { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" }]);
  return res.value;
}

async function connect() {
  const p = provider();
  if (!p) {
    say("No Solana wallet found. Install Phantom (phantom.com), Solflare or Backpack, then reload this page.", "msg err");
    return;
  }
  try {
    const res = await p.connect();
    setWallet((res?.publicKey || p.publicKey).toString());
    p.on?.("accountChanged", (pk) => setWallet(pk ? pk.toString() : null));
    p.on?.("disconnect", () => setWallet(null));
  } catch {
    say("Connection cancelled.", "msg err");
  }
}

function setWallet(w) {
  wallet = w;
  owed = 0n;
  $("c-wallet").textContent = w || "not connected";
  $("connect-top").textContent = w ? short(w) : "Connect";
  $("c-connect").hidden = !!w;
  $("c-claim").hidden = !w;
  $("c-claim").disabled = true;
  for (const id of ["c-claimable", "c-balance", "c-wins", "c-claimed", "c-sol"]) $(id).textContent = "–";
  if (w) {
    say("Connected. Make sure the wallet is set to Devnet: the claim is a devnet transaction.");
    updateWallet();
  } else {
    say("Connect Phantom, Solflare or Backpack, set to Devnet.");
  }
}
$("c-connect").addEventListener("click", connect);
$("connect-top").addEventListener("click", () => (wallet ? document.getElementById("claim").scrollIntoView({ behavior: "smooth" }) : connect()));
$("c-claim").addEventListener("click", claim);

/** Reads the wallet's Rewards account, token balance and SOL from devnet. */
async function updateWallet(keepMessage = false) {
  if (!wallet || !window.solanaWeb3) return;
  const w = wallet;
  try {
    const k = claimAddresses(w);
    const [accs, sol] = await Promise.all([
      rpc("getMultipleAccounts", [[k.rewards.toBase58(), k.destination.toBase58()], { encoding: "base64", commitment: "confirmed" }]),
      rpc("getBalance", [w, { commitment: "confirmed" }]),
    ]);
    if (w !== wallet) return;
    const rw = accs.value[0] ? parseRewards(fromBase64(accs.value[0].data[0])) : null;
    const held = accs.value[1] ? tokenAmount(fromBase64(accs.value[1].data[0])) : 0n;
    owed = rw ? rw.owed : 0n;
    $("c-claimable").textContent = `${fmtTokens(owed)} Shale`;
    $("c-balance").textContent = fmtTokens(held);
    $("c-wins").textContent = rw ? String(rw.wins) : "0";
    $("c-claimed").textContent = rw ? fmtTokens(rw.totalWithdrawn) : "0";
    $("c-sol").textContent = (sol.value / 1e9).toFixed(4);
    $("c-claim").disabled = busy || owed === 0n;
    if (!busy && !keepMessage) {
      if (owed > 0n) say("Ready to claim. Check the wallet shows Devnet before you approve.");
      else if (rw) say("Nothing to claim right now. New wins are credited here as they happen.");
      else say("No wins credited to this wallet yet. Put this address in PAYOUT in the miner's start script.");
    }
  } catch (e) {
    if (!busy) say(`Could not read the claimable balance (${e.message}).`, "msg err");
  }
}

async function claim() {
  if (!wallet || busy || owed === 0n) return;
  const p = provider();
  busy = true;
  $("c-claim").disabled = true;
  const w = wallet;
  try {
    say("Preparing the claim on devnet…");
    const { tx, lastValidBlockHeight } = await buildClaim(w);
    // Check it on devnet first, so a claim that would fail never reaches the wallet.
    const sim = await simulate(tx);
    if (sim.err) throw new Error(reason(sim.err));
    say("Approve the transaction in your wallet (it should show Devnet).");
    let sig;
    if (typeof p.signTransaction === "function") {
      // Signed by the wallet, sent by this page to devnet, so it lands on devnet even if
      // the wallet's own network setting is wrong.
      const signed = await p.signTransaction(tx);
      sig = await rpc("sendTransaction", [toB64(signed.serialize()), { encoding: "base64", preflightCommitment: "confirmed" }]);
    } else if (typeof p.signAndSendTransaction === "function") {
      const res = await p.signAndSendTransaction(tx);
      sig = res.signature || res;
    } else {
      throw new Error("This wallet cannot sign transactions here.");
    }
    sayLink("Sent. Waiting for confirmation…", txLink(sig), "View on Explorer", "msg");
    for (;;) {
      const st = (await rpc("getSignatureStatuses", [[sig]])).value[0];
      if (st?.err) throw Object.assign(new Error(reason(st.err)), { sig });
      if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) break;
      const height = await rpc("getBlockHeight", [{ commitment: "confirmed" }]);
      if (height > lastValidBlockHeight) throw Object.assign(new Error("The claim expired before it landed. Nothing was taken; try again."), { sig });
      await new Promise((r) => setTimeout(r, 1500));
    }
    sayLink(`Claimed ${fmtTokens(owed)} Shale.`, txLink(sig), "View on Explorer");
  } catch (e) {
    const msg = e?.message?.includes("User rejected") ? "Cancelled in the wallet." : e.message || String(e);
    if (e.sig) sayLink(msg, txLink(e.sig), "View on Explorer", "msg err");
    else say(msg, "msg err");
  } finally {
    busy = false;
    if (w === wallet) await updateWallet(true);
  }
}
