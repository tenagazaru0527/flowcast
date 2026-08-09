export const Q = 65_536;
export const ADVECTION_WEIGHT = Q;
export const DIFFUSION_WEIGHT = Q >> 2;

// All simulation values are signed 32-bit integers. Fixed-point products are
// intentionally bounded below 2^53: |Q value| <= 8,388,608 (128.0), so the
// largest generic fixed-point product is <= 2^46. Aggregate limits are checked by the
// engine before addition and remain <= 2^31 - 1 with this configuration.
export const DEFAULT_CONFIG = Object.freeze({
  width: 64,
  height: 64,
  capacity: 4 * Q,
  guideLimit: Q,
  burnRadius: 2 * Q,
  injectionPerStep: Q >> 6,
  steps: 3_600,
  completionTarget: 32 * Q,
  transferRate: Q >> 2,
  // With the default capacity and transfer rate, one cell's total transfer
  // budget is at most mulQ(4 * Q, Q >> 2) = Q, so this is effectively unlimited.
  edgeFluxMax: Q,
  advectionWeight: ADVECTION_WEIGHT,
  diffusionWeight: DIFFUSION_WEIGHT,
  reverseThreshold: 3 * Q,
  reverseStrength: Q >> 2,
  reverseDamping: (3 * Q) >> 2,
  reverseLimit: Q,
  restoreWeight: 0,
  congestionWeight: 0,
  congestionReference: 4 * Q,
});

const FIXED_POINT_KEYS = Object.freeze([
  "capacity", "guideLimit", "burnRadius", "injectionPerStep", "completionTarget",
  "transferRate", "edgeFluxMax", "advectionWeight", "diffusionWeight", "reverseThreshold",
  "reverseStrength", "reverseDamping", "reverseLimit", "restoreWeight", "congestionWeight",
  "congestionReference",
]);

export function createConfig(overrides = {}) {
  const config = { ...DEFAULT_CONFIG, ...overrides };
  if (!Object.hasOwn(overrides, "corridorWidth")) config.corridorWidth = config.width + config.height;
  const integerKeys = [
    "width",
    "height",
    "capacity",
    "guideLimit",
    "burnRadius",
    "injectionPerStep",
    "steps",
    "completionTarget",
    "transferRate",
    "edgeFluxMax",
    "advectionWeight",
    "diffusionWeight",
    "reverseThreshold",
    "reverseStrength",
    "reverseDamping",
    "reverseLimit",
    "restoreWeight",
    "congestionWeight",
    "congestionReference",
    "corridorWidth",
  ];

  for (let index = 0; index < integerKeys.length; index += 1) {
    const key = integerKeys[index];
    if (!Number.isInteger(config[key])) {
      throw new TypeError(`${key} must be an integer`);
    }
  }
  for (let index = 0; index < FIXED_POINT_KEYS.length; index += 1) {
    const key = FIXED_POINT_KEYS[index];
    if (config[key] < 0 || config[key] > 128 * Q) {
      throw new RangeError(`${key} must be in Q16.16 range [0, 128]`);
    }
  }
  if (config.width <= 0 || config.height <= 0 || config.steps <= 0) {
    throw new RangeError("width, height, and steps must be positive");
  }
  if (config.capacity <= 0 || config.burnRadius <= 0) {
    throw new RangeError("capacity and burnRadius must be positive");
  }
  if (config.congestionReference <= 0) {
    throw new RangeError("congestionReference must be positive");
  }
  if (config.corridorWidth < 0 || config.corridorWidth > config.width + config.height) {
    throw new RangeError("corridorWidth must be an integer cell distance in [0, width + height]");
  }
  if (config.injectionPerStep * config.steps > 2_147_483_647) {
    throw new RangeError("total configured injection must fit Int32");
  }
  if (config.guideLimit > Q || config.reverseLimit > Q) {
    throw new RangeError("guide limits must not exceed Q16.16 value 1.0");
  }
  return Object.freeze(config);
}
