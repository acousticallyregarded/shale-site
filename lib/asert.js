// The rounds program's difficulty rule, for the live round panel. A copy of
// solana/sim/asert.mjs (the site serves only web/); solana/sim/check-asert.mjs checks both
// copies against the Rust vectors (solana/vectors/asert.json).

export const Q = 65536n;          // 16.16 fixed point: one doubling = 65,536
export const MAX_STEP = 65536n;   // per-round clamp: at most x2 easier or x2 harder
const ELAPSED_CLAMP = 1n << 40n;  // |elapsed - target| is clamped first, so the products fit i64

/** DECODE_COMPACT (SPEC 11): a 256-bit target, or null when invalid. */
export function decodeCompact(bits) {
  bits = BigInt(bits) & 0xffffffffn;
  const e = bits >> 24n, m = bits & 0x7fffffn;
  if (bits & 0x800000n) return null;
  if (m === 0n) return null;
  let t;
  if (e <= 3n) t = m >> (8n * (3n - e));
  else {
    if (e > 34n || (e === 34n && m > 0xffn) || (e === 33n && m > 0xffffn)) return null;
    t = m << (8n * (e - 3n));
  }
  if (t === 0n || t >= (1n << 256n)) return null;
  return t;
}

/** ENCODE_COMPACT (Bitcoin's GetCompact, truncating): the largest compact target <= t. */
export function encodeCompact(t) {
  t = BigInt(t);
  if (t <= 0n) throw new Error("target must be positive");
  let size = 0n;
  for (let x = t; x > 0n; x >>= 8n) size++;
  let m = size <= 3n ? t << (8n * (3n - size)) : t >> (8n * (size - 3n));
  if (m & 0x800000n) { m >>= 8n; size++; }
  return Number((size << 24n) | m);
}

/** aserti3-2d's 2^(frac/65536) * 65536 for frac in [0, 65535]. */
export function factor(frac) {
  frac = BigInt(frac);
  return Q + ((195766423245049n * frac + 971821376n * frac * frac + 5127n * frac * frac * frac + (1n << 47n)) >> 48n);
}

/** The exponent in 1/65536 doublings for a round of `elapsed` slots, truncated toward zero,
 *  then clamped to +-MAX_STEP. */
export function exponent(elapsed, targetSlots, halflife) {
  let d = BigInt(elapsed) - BigInt(targetSlots);
  if (d > ELAPSED_CLAMP) d = ELAPSED_CLAMP;
  if (d < -ELAPSED_CLAMP) d = -ELAPSED_CLAMP;
  const num = d * Q;
  let x = num / BigInt(halflife); // BigInt division truncates toward zero, like Rust's i64 `/`
  if (x > MAX_STEP) x = MAX_STEP;
  if (x < -MAX_STEP) x = -MAX_STEP;
  return x;
}

/** The next round's bits from this round's bits and its elapsed slots. maxTarget is a BigInt. */
export function nextBits(bits, elapsed, targetSlots, halflife, maxTarget) {
  const t = decodeCompact(bits);
  if (t === null) throw new Error("bits do not decode");
  const x = exponent(elapsed, targetSlots, halflife);
  const shifts = x >> 16n; // floor
  const frac = x - (shifts << 16n); // 0..65535
  let n = (t * factor(frac)) >> (16n - shifts);
  if (n < 1n) n = 1n;
  if (n > maxTarget) n = maxTarget;
  return encodeCompact(n);
}

/** Expected attempts for a target: 2^256 / (T + 1), as a float. */
export function expectedAttempts(bits) {
  const t = decodeCompact(bits);
  return t === null ? Infinity : Number((1n << 256n) / (t + 1n));
}
