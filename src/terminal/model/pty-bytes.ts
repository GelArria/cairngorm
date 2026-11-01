/** Concatenates bytes into one. */
export function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** If queued is fully contained in the replay buffer, discard it (reattach duplicate).
 *  only checks the "queued ⊂ replay buffer" case; partial overlaps remain (cosmetic). */
export function stripReplaySuffix(replay: Uint8Array, queued: Uint8Array): Uint8Array {
  const k = queued.length;
  if (k === 0 || replay.length < k) {
    return queued;
  }
  for (let i = 0; i < k; i++) {
    if (replay[replay.length - k + i] !== queued[i]) {
      return queued;
    }
  }
  return new Uint8Array(0);
}

export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
