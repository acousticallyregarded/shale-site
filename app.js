// Live round data from Solana devnet and the wallet panel.
import { parseDeployment, parseRound, tokenAmount, deriveStatus, expectedAttempts, fromBase64, STATUS } from "./lib/status.js";

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
const mascot = $("mascot");
if (mascot) mascot.addEventListener("click", () => { $("speech").textContent = FACTS[fact++ % FACTS.length]; });

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
    const status = deriveStatus(dep, r, vault, BigInt(slot));
    const open = r.status === STATUS.OPEN && !status.includes("awaiting");
    $("v-round").textContent = `#${r.roundId}`;
    $("v-status").textContent = status.split(",")[0];
    $("v-status").className = "status-pill " + (open ? "open" : "wait");
    $("v-reward").textContent = fmtTokens(r.reward || dep.reward);
    $("v-diff").textContent = fmtAttempts(expectedAttempts(r.bits || dep.bits));
    $("v-vault").textContent = fmtTokens(vault);
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
    updateWalletWins();
  } catch (e) {
    $("v-updated").textContent = `Could not reach Solana devnet (${e.message}). Retrying…`;
  }
}
refresh();
setInterval(refresh, 20000);

// ---------- wallet ----------
function provider() {
  if (window.phantom?.solana?.isPhantom) return window.phantom.solana;
  if (window.solflare?.isSolflare) return window.solflare;
  if (window.backpack?.isBackpack) return window.backpack;
  if (window.solana) return window.solana;
  return null;
}
let wallet = null;

async function connect() {
  const p = provider();
  if (!p) {
    $("c-msg").className = "msg err";
    $("c-msg").innerHTML = "";
    $("c-msg").append("No Solana wallet found. Install Phantom (phantom.com) or Solflare, then reload this page.");
    return;
  }
  try {
    const res = await p.connect();
    wallet = (res?.publicKey || p.publicKey).toString();
    $("c-wallet").textContent = wallet;
    $("connect-top").textContent = short(wallet);
    $("c-connect").hidden = true;
    $("c-msg").className = "msg";
    $("c-msg").textContent = "Make sure your wallet is set to Devnet.";
    await updateWallet();
  } catch (e) {
    $("c-msg").className = "msg err";
    $("c-msg").textContent = "Connection cancelled.";
  }
}
$("c-connect").addEventListener("click", connect);
$("connect-top").addEventListener("click", () => (wallet ? document.getElementById("claim").scrollIntoView({ behavior: "smooth" }) : connect()));

async function updateWallet() {
  if (!wallet) return;
  try {
    const res = await rpc("getTokenAccountsByOwner", [wallet, { mint: IDS.mint }, { encoding: "jsonParsed", commitment: "confirmed" }]);
    let total = 0n;
    for (const a of res.value) total += BigInt(a.account.data.parsed.info.tokenAmount.amount);
    $("c-balance").textContent = fmtTokens(total);
  } catch {
    $("c-balance").textContent = "?";
  }
  updateWalletWins();
  // On-site claiming needs the reward ledger added by the next program upgrade.
  $("c-claimable").textContent = "–";
  $("c-msg").className = "msg";
  $("c-msg").textContent = "On-site claiming opens with the next program upgrade. Until then, wins are paid straight to the mining wallet.";
}

function updateWalletWins() {
  if (!wallet || !lastRound) return;
  const n = lastRound.history.filter((h) => h.winner === wallet).length;
  $("c-wins").textContent = String(n);
}
