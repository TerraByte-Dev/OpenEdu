// Learner PINs: PBKDF2-SHA256 through WebCrypto. Pure module (WebCrypto is a web standard, present in
// the Tauri webview and in node), tested in learner-pin.test.ts.
//
// What this is for: keeping one learner out of another's courses on a shared PC. It is NOT security
// against someone holding the database file: a 4-6 digit PIN has at most 1,111,000 values, and the
// salt + hash sit next to each other in openedu.db, so an offline search over every PIN is cheap no
// matter the iteration count. The iterations only make each on-screen guess and each offline guess
// cost something. Never log, store or return the PIN itself.

export const PIN_ITERATIONS = 210_000;
const MIN_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BITS = 256;
const SCHEME = "pbkdf2-sha256";

const PIN_PATTERN = /^\d{4,6}$/;

/** 4 to 6 digits, nothing else. */
export function isValidPin(pin: string): boolean {
  return PIN_PATTERN.test(pin);
}

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(b64: string): Uint8Array | null {
  try {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

async function derive(pin: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    key,
    HASH_BITS,
  );
  return new Uint8Array(bits);
}

export interface PinRecord {
  /** "pbkdf2-sha256$<iterations>$<base64 hash>": the iteration count travels with the hash. */
  pin_hash: string;
  /** base64 of 16 random bytes. */
  pin_salt: string;
}

/** Hash a new PIN with a fresh random salt. Throws on a PIN that isn't 4-6 digits. */
export async function hashPin(pin: string, iterations = PIN_ITERATIONS): Promise<PinRecord> {
  if (!isValidPin(pin)) throw new Error("PIN must be 4 to 6 digits");
  if (iterations < MIN_ITERATIONS) throw new Error("too few PBKDF2 iterations");
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(pin, salt, iterations);
  return { pin_hash: `${SCHEME}$${iterations}$${toB64(hash)}`, pin_salt: toB64(salt) };
}

/**
 * Check a typed PIN against a stored record. Constant-shape: the derivation always runs (even for a
 * malformed PIN or record) and the comparison always walks every byte, so how long a wrong guess takes
 * says nothing about how close it was. A malformed record never verifies.
 */
export async function verifyPin(pin: string, record: { pin_hash: string | null; pin_salt: string | null }): Promise<boolean> {
  const parts = (record.pin_hash ?? "").split("$");
  const iterations = Number(parts[1]);
  const expected = parts.length === 3 && parts[0] === SCHEME ? fromB64(parts[2]) : null;
  const salt = record.pin_salt ? fromB64(record.pin_salt) : null;
  const wellFormed =
    expected !== null && expected.length === HASH_BITS / 8 &&
    salt !== null && salt.length > 0 &&
    Number.isInteger(iterations) && iterations >= MIN_ITERATIONS;

  const actual = await derive(
    pin,
    wellFormed ? salt! : new Uint8Array(SALT_BYTES),
    wellFormed ? iterations : PIN_ITERATIONS,
  );
  const target = wellFormed ? expected! : new Uint8Array(HASH_BITS / 8);
  let diff = 0;
  for (let i = 0; i < target.length; i++) diff |= actual[i] ^ target[i];
  return wellFormed && isValidPin(pin) && diff === 0;
}
