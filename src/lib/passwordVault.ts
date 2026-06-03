// Opt-in password vault — stores the user's plaintext password
// encrypted with a key derived from their user.id, so the
// "Voir mon mot de passe" row in Settings → Sécurité can reveal it.
//
// THREAT MODEL — read this before changing:
// - Encryption uses WebCrypto's AES-GCM with a 256-bit key derived
//   via PBKDF2 (100k iterations) from `userId + VAULT_PEPPER`. The
//   pepper is a static string baked into the bundle.
// - localStorage is the storage layer. Anyone who can run JS in the
//   app's origin (XSS, browser extensions, devtools) can read the
//   ciphertext AND the derivation inputs, and therefore decrypt.
//   This is the same threat surface as the Supabase session token
//   already stored next to it — if the page is compromised, the
//   session is too.
// - Vault is per-browser. Logging in on another device starts fresh
//   with no vault until the user re-opts-in there.
// - On any signout (local, global, or account delete) the vault is
//   cleared via clearVault().
//
// NEVER use this for anything other than this specific UX feature.
// It's opt-in, the user explicitly asked for it.

const STORAGE_KEY = 'revs-pwd-vault'
const VAULT_PEPPER = 'revs-vault-pepper-v1-2026'
const KDF_SALT = 'revs-vault-salt-v1'
const KDF_ITERATIONS = 100_000

type StoredVault = {
  iv: string // base64
  ct: string // base64
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64)
  const out = new Uint8Array(new ArrayBuffer(s.length))
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i)
  return out
}

function hasCrypto(): boolean {
  return (
    typeof crypto !== 'undefined' &&
    typeof crypto.subtle !== 'undefined' &&
    typeof crypto.getRandomValues === 'function'
  )
}

async function deriveKey(userId: string): Promise<CryptoKey> {
  const enc = new TextEncoder()
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(userId + '|' + VAULT_PEPPER),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: enc.encode(KDF_SALT),
      iterations: KDF_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** Encrypts `password` with a key derived from `userId` and persists
 *  the result in localStorage. Silent no-op if WebCrypto isn't
 *  available (very old browsers) — the feature just stays disabled. */
export async function storeVault(
  userId: string,
  password: string,
): Promise<void> {
  if (!hasCrypto() || typeof localStorage === 'undefined') return
  if (!userId || !password) return
  try {
    const key = await deriveKey(userId)
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const enc = new TextEncoder()
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      enc.encode(password),
    )
    const payload: StoredVault = {
      iv: bytesToBase64(iv),
      ct: bytesToBase64(new Uint8Array(ct)),
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // Encryption failed — better to drop the vault silently than
    // store something we can't read back.
  }
}

/** Returns the decrypted password if a vault exists for this user,
 *  else null. Returns null on any decryption failure (corrupt blob,
 *  user changed, etc.). */
export async function readVault(userId: string): Promise<string | null> {
  if (!hasCrypto() || typeof localStorage === 'undefined') return null
  if (!userId) return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const payload = JSON.parse(raw) as StoredVault
    if (!payload?.iv || !payload?.ct) return null
    const key = await deriveKey(userId)
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(payload.iv) },
      key,
      base64ToBytes(payload.ct),
    )
    return new TextDecoder().decode(pt)
  } catch {
    return null
  }
}

/** Quick synchronous check — used to render the eye-icon state
 *  without paying for a full decryption cycle. */
export function hasVault(): boolean {
  if (typeof localStorage === 'undefined') return false
  return localStorage.getItem(STORAGE_KEY) !== null
}

/** Wipes the vault. Must be called on every signout path (local
 *  signout, global signout, account deletion) so a re-login doesn't
 *  inherit a stale password from an earlier session or, worse, from
 *  the previous account on the same browser. */
export function clearVault(): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* private mode etc. — ignore */
  }
}
