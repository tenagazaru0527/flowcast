import { Q } from "./config.js";

export function toQ(integer) {
  if (!Number.isInteger(integer)) {
    throw new TypeError("toQ accepts integers only");
  }
  return (integer * Q) | 0;
}

// Callers keep |a| and |b| <= 8,388,608, making |a*b| <= 2^46 < 2^53.
export function mulQ(a, b) {
  return ((a * b) / Q) | 0;
}

// The caller guarantees b !== 0. The configured numerator is below 2^53.
export function divQ(a, b) {
  if (b === 0) {
    throw new RangeError("fixed-point division by zero");
  }
  return ((a * Q) / b) | 0;
}

export function clampInt32(value, minimum, maximum) {
  if (value < minimum) return minimum | 0;
  if (value > maximum) return maximum | 0;
  return value | 0;
}

export function isqrt(n) {
  if (!Number.isInteger(n) || n < 0) {
    throw new RangeError("isqrt requires a non-negative integer");
  }
  if (n < 2) return n;
  let bit = 1;
  while (bit * 4 <= n) bit *= 4;
  let rest = n;
  let result = 0;
  while (bit >= 1) {
    if (rest >= result + bit) {
      rest -= result + bit;
      result = result / 2 + bit;
    } else {
      result /= 2;
    }
    bit /= 4;
  }
  return result;
}

export function clampVector(x, y, limit) {
  // Call sites remain below 2^36 here; no bitwise coercion may occur before division.
  const magnitudeSquared = x * x + y * y;
  const limitSquared = limit * limit;
  if (magnitudeSquared <= limitSquared) return [x, y];
  const magnitude = isqrt(magnitudeSquared);
  return [((x * limit) / magnitude) | 0, ((y * limit) / magnitude) | 0];
}

export class XorShift32 {
  constructor(seed) {
    if (!Number.isInteger(seed)) {
      throw new TypeError("seed must be an integer");
    }
    this.state = seed | 0;
    if (this.state === 0) this.state = 0x6d2b79f5 | 0;
  }

  nextInt32() {
    let value = this.state | 0;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.state = value | 0;
    return this.state;
  }
}

export function fnv1aInt32(values) {
  let hash = 0x811c9dc5 | 0;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index] | 0;
    hash = Math.imul(hash ^ (value & 0xff), 0x01000193);
    hash = Math.imul(hash ^ ((value >>> 8) & 0xff), 0x01000193);
    hash = Math.imul(hash ^ ((value >>> 16) & 0xff), 0x01000193);
    hash = Math.imul(hash ^ ((value >>> 24) & 0xff), 0x01000193);
  }
  return hash >>> 0;
}

export function hashHex(values) {
  return fnv1aInt32(values).toString(16).padStart(8, "0");
}
