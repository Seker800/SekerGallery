const HASH_PATTERN = /^[0-9a-f]{16}$/;

/** 9x8 grayscale gradient hash; rows are visited top to bottom, left to right. */
export function dhash64(gray: ArrayLike<number>): string {
  if (gray.length < 72) throw new Error('DHASH_INPUT_TOO_SHORT');
  let hash = 0n;
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++)
      hash = (hash << 1n) | (gray[y * 9 + x]! > gray[y * 9 + x + 1]! ? 1n : 0n);
  return hash.toString(16).padStart(16, '0');
}

/** Invalid or malformed hashes never look similar. */
export function hashDistance64(left: string, right: string): number {
  if (!HASH_PATTERN.test(left) || !HASH_PATTERN.test(right)) return 65;
  let bits = BigInt(`0x${left}`) ^ BigInt(`0x${right}`);
  let distance = 0;
  while (bits) {
    bits &= bits - 1n;
    distance++;
  }
  return distance;
}
