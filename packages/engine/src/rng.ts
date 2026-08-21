/**
 * sfc32 -- a small, fast, statistically solid PRNG (passes PractRand).
 *
 * Hand-rolled rather than pulled from npm on purpose: a dependency bump that
 * changes the generator would silently invalidate every stored replay, and we
 * would have no way to notice. 128 bits of state as four uint32s, which is plain
 * JSON and therefore survives serialization, persistence and redaction.
 *
 * Threaded purely: every call returns the next state rather than mutating.
 */
export type RngState = readonly [number, number, number, number]

export function nextU32(s: RngState): [number, RngState] {
  let [a, b, c, d] = s as [number, number, number, number]
  const t = (((a + b) | 0) + d) | 0
  d = (d + 1) | 0
  a = b ^ (b >>> 9)
  b = (c + (c << 3)) | 0
  c = (c << 21) | (c >>> 11)
  c = (c + t) | 0
  return [t >>> 0, [a, b, c, d]]
}

/**
 * Unbiased bounded integer in [0, n).
 *
 * Rejection sampling, never `% n`: the modulo shortcut biases low values, which
 * over thousands of shuffles is a visible, unfair deck order.
 */
export function nextInt(s0: RngState, n: number): [number, RngState] {
  if (n <= 0) throw new Error(`nextInt: n must be positive, got ${n}`)
  if (n === 1) return [0, s0]
  const limit = Math.floor(0x100000000 / n) * n
  let s = s0
  let x = 0
  do {
    ;[x, s] = nextU32(s)
  } while (x >= limit)
  return [x % n, s]
}

/** Fisher-Yates. Returns a new array; does not mutate the input. */
export function shuffle<T>(s0: RngState, xs: readonly T[]): [T[], RngState] {
  const a = xs.slice()
  let s = s0
  for (let i = a.length - 1; i > 0; i--) {
    let j: number
    ;[j, s] = nextInt(s, i + 1)
    const ai = a[i] as T
    const aj = a[j] as T
    a[i] = aj
    a[j] = ai
  }
  return [a, s]
}

/**
 * xmur3 seed expansion. `seed` should be a hex string from a CSPRNG at match
 * creation -- generated *outside* the engine and passed in, since the engine may
 * not touch `crypto`.
 */
export function seedRng(seed: string): RngState {
  let h = 1779033703 ^ seed.length
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  const next = (): number => {
    h = Math.imul(h ^ (h >>> 16), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    return (h ^= h >>> 16) >>> 0
  }
  let r: RngState = [next(), next(), next(), next()]
  // Warm-up: discard the first few outputs so closely-related seeds diverge.
  for (let i = 0; i < 15; i++) r = nextU32(r)[1]
  return r
}

/** Random lowercase-hex string of `len` chars, drawn from the seeded stream. */
export function nextHex(s0: RngState, len: number): [string, RngState] {
  let s = s0
  let out = ''
  while (out.length < len) {
    let v: number
    ;[v, s] = nextU32(s)
    out += v.toString(16).padStart(8, '0')
  }
  return [out.slice(0, len), s]
}
