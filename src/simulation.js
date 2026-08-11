import { createConfig, Q } from "./config.js";
import { buildRestoreField, burnLines } from "./lines.js";
import { clampVector, hashHex, isqrt, mulQ } from "./fixed-point.js";

const DIRECTION_X = [0, 1, 0, -1];
const DIRECTION_Y = [-1, 0, 1, 0];
const COHERENCE_SIGMA_THRESHOLD = 2 * Q;

function checkedAdd(left, right, label) {
  const result = left + right;
  if (result < -2_147_483_648 || result > 2_147_483_647) {
    throw new RangeError(`${label} exceeded Int32 range`);
  }
  return result | 0;
}

function addUnsigned64(accumulator, value) {
  const previousLow = accumulator[0];
  const nextLow = (previousLow + value) >>> 0;
  accumulator[0] = nextLow;
  if (nextLow < previousLow) accumulator[1] = (accumulator[1] + 1) >>> 0;
}

// Measurement counters stay as two 32-bit words while accumulating. Conversion
// remains exact up to 2^53 - 1 and rejects larger diagnostic results.
function unsigned64ToSafeInteger(accumulator, label) {
  const result = accumulator[1] * 4_294_967_296 + accumulator[0];
  if (!Number.isSafeInteger(result)) {
    throw new RangeError(label + " exceeded the safe integer range");
  }
  return result;
}

function addUnsigned64Words(accumulator, value) {
  const previousLow = accumulator[0];
  accumulator[0] = (accumulator[0] + value[0]) >>> 0;
  const carry = accumulator[0] < previousLow ? 1 : 0;
  accumulator[1] = (accumulator[1] + value[1] + carry) >>> 0;
}

function compareUnsigned64(left, right) {
  if (left[1] !== right[1]) return left[1] > right[1] ? 1 : -1;
  if (left[0] === right[0]) return 0;
  return left[0] > right[0] ? 1 : -1;
}

function percentageUnsigned64(numerator, denominator) {
  if (denominator[0] === 0 && denominator[1] === 0) return 0;
  const scaledNumerator = new Uint32Array(2);
  for (let count = 0; count < 100; count += 1) addUnsigned64Words(scaledNumerator, numerator);
  const denominatorMultiple = new Uint32Array(2);
  for (let percent = 1; percent <= 100; percent += 1) {
    addUnsigned64Words(denominatorMultiple, denominator);
    if (compareUnsigned64(denominatorMultiple, scaledNumerator) > 0) return percent - 1;
  }
  return 100;
}

function divideUnsigned64ByInt32(accumulator, divisor) {
  if (divisor <= 0) throw new RangeError("diagnostic divisor must be positive");
  let quotient = 0;
  let remainder = 0;
  for (let bit = 63; bit >= 0; bit -= 1) {
    const inputBit = bit >= 32
      ? (accumulator[1] >>> (bit - 32)) & 1
      : (accumulator[0] >>> bit) & 1;
    remainder = ((remainder << 1) | inputBit) >>> 0;
    if (remainder < divisor) continue;
    remainder = (remainder - divisor) >>> 0;
    if (bit >= 31) throw new RangeError("diagnostic quotient exceeded Int32 range");
    quotient |= 1 << bit;
  }
  return quotient | 0;
}

function integerSquareRoot(value) {
  let low = 0;
  let high = 2 * Q;
  let result = 0;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const square = middle * middle;
    if (square <= value) {
      result = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return result | 0;
}

function guideMagnitudeMax(field) {
  let maximum = 0;
  for (let index = 0; index < field.guideX.length; index += 1) {
    const x = field.guideX[index];
    const y = field.guideY[index];
    const magnitude = integerSquareRoot(x * x + y * y);
    if (magnitude > maximum) maximum = magnitude;
  }
  return maximum;
}

function measureSigmaProfile(density, config) {
  const profile = new Array(config.width).fill(null);
  for (let x = 0; x < config.width; x += 1) {
    let total = 0;
    let weightedY = 0;
    let weightedYSquared = 0;
    for (let y = 0; y < config.height; y += 1) {
      const amount = density[y * config.width + x];
      total += amount;
      weightedY += y * amount;
      weightedYSquared += y * y * amount;
    }
    if (total === 0) continue;

    // Moments are accumulated with integer coordinates. Products stay below
    // 2^53 for the configured 64x64 field and total-injection bound.
    const centroid = ((weightedY * Q) / total) | 0;
    const secondMoment = ((weightedYSquared * Q) / total) | 0;
    const variance = secondMoment - mulQ(centroid, centroid);
    profile[x] = isqrt((variance > 0 ? variance : 0) * Q);
  }
  return profile;
}

function measureCoherenceLengthSigma(profile, sourceX) {
  const startX = sourceX + 2;
  for (let x = startX; x < profile.length; x += 1) {
    const sigma = profile[x];
    if (sigma !== null && sigma > COHERENCE_SIGMA_THRESHOLD) return x;
  }
  return profile.length - 1;
}

function measureBandProfile(density, config, threshold) {
  const bandCells = new Array(config.width).fill(0);
  const segmentCount = new Array(config.width).fill(0);
  const meanSegmentWidth = new Array(config.width).fill(null);
  for (let x = 0; x < config.width; x += 1) {
    let insideSegment = false;
    for (let y = 0; y < config.height; y += 1) {
      const aboveThreshold = density[y * config.width + x] > threshold;
      if (aboveThreshold) {
        bandCells[x] += 1;
        if (!insideSegment) segmentCount[x] += 1;
      }
      insideSegment = aboveThreshold;
    }
    if (segmentCount[x] > 0) {
      meanSegmentWidth[x] = ((bandCells[x] * Q) / segmentCount[x]) | 0;
    }
  }
  return { bandCells, segmentCount, meanSegmentWidth };
}

function measureCoherenceLength(profile, sourceX) {
  const startX = sourceX + 2;
  const w0 = profile[startX];
  if (w0 === null || w0 === undefined) return { coherenceLength: null, w0: null };
  const threshold = w0 * 2;
  for (let x = startX; x < profile.length; x += 1) {
    const width = profile[x];
    if (width !== null && width > threshold) return { coherenceLength: x, w0 };
  }
  return { coherenceLength: profile.length - 1, w0 };
}

function cellIndex(point, config, label) {
  if (!Array.isArray(point) || point.length !== 2) {
    throw new TypeError(`${label} must be [x, y]`);
  }
  const x = point[0];
  const y = point[1];
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= config.width || y >= config.height) {
    throw new RangeError(`${label} is outside the field`);
  }
  return y * config.width + x;
}

function cellIndices(points, config, label) {
  if (!Array.isArray(points) || points.length === 0) {
    throw new TypeError(`${label} must be a non-empty array of [x, y] coordinates`);
  }
  const indices = new Int32Array(points.length);
  const seen = new Uint8Array(config.width * config.height);
  for (let index = 0; index < points.length; index += 1) {
    const cell = cellIndex(points[index], config, `${label}[${index}]`);
    if (seen[cell] !== 0) throw new RangeError(`${label} must not contain duplicate coordinates`);
    seen[cell] = 1;
    indices[index] = cell;
  }
  return indices;
}

function createBlockedMask(points, config) {
  if (!Array.isArray(points)) throw new TypeError("blocked must be an array of [x, y] coordinates");
  const mask = new Uint8Array(config.width * config.height);
  for (let index = 0; index < points.length; index += 1) {
    const cell = cellIndex(points[index], config, `blocked[${index}]`);
    if (mask[cell] !== 0) throw new RangeError("blocked must not contain duplicate coordinates");
    mask[cell] = 1;
  }
  return { mask, count: points.length };
}

function createGapMap(gaps, blockedMask, config) {
  if (!Array.isArray(gaps)) throw new TypeError("gaps must be an array");
  const cellToGap = new Uint8Array(config.width * config.height);
  const names = [];
  for (let gapIndex = 0; gapIndex < gaps.length; gapIndex += 1) {
    const gap = gaps[gapIndex];
    if (gap === null || typeof gap !== "object" || Array.isArray(gap)) {
      throw new TypeError(`gaps[${gapIndex}] must be an object`);
    }
    if (typeof gap.name !== "string" || gap.name.length === 0 || names.includes(gap.name)) {
      throw new RangeError("gap names must be non-empty and unique");
    }
    const indices = cellIndices(gap.cells, config, `gaps[${gapIndex}].cells`);
    names.push(gap.name);
    for (let cellIndexOffset = 0; cellIndexOffset < indices.length; cellIndexOffset += 1) {
      const cell = indices[cellIndexOffset];
      if (blockedMask[cell] !== 0) throw new RangeError("gap cells must not be blocked");
      if (cellToGap[cell] !== 0) throw new RangeError("gap cells must not overlap");
      cellToGap[cell] = gapIndex + 1;
    }
  }
  return { cellToGap, names };
}

function createSinkGroupMap(sinkGroups, sinkIndices, config) {
  if (sinkGroups === undefined) return null;
  if (!Array.isArray(sinkGroups) || sinkGroups.length > 4) {
    throw new RangeError("sinkGroups must be an array containing at most four groups");
  }
  const sinkMask = new Uint8Array(config.width * config.height);
  for (let index = 0; index < sinkIndices.length; index += 1) sinkMask[sinkIndices[index]] = 1;
  const cellToGroup = new Uint8Array(config.width * config.height);
  const names = [];
  let assigned = 0;
  for (let groupIndex = 0; groupIndex < sinkGroups.length; groupIndex += 1) {
    const group = sinkGroups[groupIndex];
    if (group === null || typeof group !== "object" || Array.isArray(group)) {
      throw new TypeError(`sinkGroups[${groupIndex}] must be an object`);
    }
    if (typeof group.name !== "string" || group.name.length === 0 || names.includes(group.name)) {
      throw new RangeError("sink group names must be non-empty and unique");
    }
    const indices = cellIndices(group.cells, config, `sinkGroups[${groupIndex}].cells`);
    names.push(group.name);
    for (let offset = 0; offset < indices.length; offset += 1) {
      const cell = indices[offset];
      if (sinkMask[cell] === 0) throw new RangeError("sink group cells must be sink cells");
      if (cellToGroup[cell] !== 0) throw new RangeError("sink group cells must not overlap");
      cellToGroup[cell] = groupIndex + 1;
      assigned += 1;
    }
  }
  if (assigned !== sinkIndices.length) {
    throw new RangeError("sinkGroups must partition every sink cell exactly once");
  }
  return { cellToGroup, names };
}

function createSourceExclusion(source, config) {
  const excluded = new Uint8Array(config.width * config.height);
  let count = 0;
  for (let sourceIndex = 0; sourceIndex < source.length; sourceIndex += 1) {
    const sourceX = source[sourceIndex][0];
    const sourceY = source[sourceIndex][1];
    for (let offset = 0; offset < 5; offset += 1) {
      const x = sourceX + [0, 0, 1, 0, -1][offset];
      const y = sourceY + [-1, 0, 0, 1, 0][offset];
      if (x < 0 || x >= config.width || y < 0 || y >= config.height) continue;
      const index = y * config.width + x;
      if (excluded[index] === 0) {
        excluded[index] = 1;
        count += 1;
      }
    }
  }
  return { excluded, count };
}

function nearestSourceDistance(x, y, source) {
  let nearest = Number.MAX_SAFE_INTEGER;
  for (let index = 0; index < source.length; index += 1) {
    const distance = Math.abs(x - source[index][0]) + Math.abs(y - source[index][1]);
    if (distance < nearest) nearest = distance;
  }
  return nearest;
}

function neighborIndex(index, direction, width, height) {
  const x = index % width;
  const y = (index / width) | 0;
  const nextX = x + DIRECTION_X[direction];
  const nextY = y + DIRECTION_Y[direction];
  if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) return -1;
  return nextY * width + nextX;
}

function measureFieldEdgeDensity(density, config) {
  let maximum = 0;
  let maximumCell = null;
  for (let index = 0; index < density.length; index += 1) {
    const x = index % config.width;
    const y = (index / config.width) | 0;
    if (x !== 0 && x !== config.width - 1 && y !== 0 && y !== config.height - 1) continue;
    if (density[index] > maximum) {
      maximum = density[index];
      maximumCell = [x, y];
    }
  }
  return { maximum, maximumCell };
}

function measureBlockedFrontDensity(density, blockedMask, blockedCount, config) {
  if (blockedCount === 0) return { maximum: null, maximumCell: null };
  let maximum = 0;
  let maximumCell = null;
  for (let index = 0; index < density.length; index += 1) {
    if (blockedMask[index] !== 0) continue;
    for (let direction = 0; direction < 4; direction += 1) {
      const neighbor = neighborIndex(index, direction, config.width, config.height);
      if (neighbor < 0 || blockedMask[neighbor] === 0) continue;
      if (density[index] > maximum) {
        maximum = density[index];
        maximumCell = [index % config.width, (index / config.width) | 0];
      }
      break;
    }
  }
  return { maximum, maximumCell };
}

function directionalComponent(x, y, direction) {
  if (direction === 0) return y < 0 ? -y : 0;
  if (direction === 1) return x > 0 ? x : 0;
  if (direction === 2) return y > 0 ? y : 0;
  return x < 0 ? -x : 0;
}

function allocatePathFlow(amount, origin, direction, field, perPathFlow) {
  let totalAlignment = 0;
  const pathCount = field.perLineGuideX.length;
  for (let path = 0; path < pathCount; path += 1) {
    totalAlignment += directionalComponent(
      field.perLineGuideX[path][origin],
      field.perLineGuideY[path][origin],
      direction,
    );
  }
  if (totalAlignment === 0) return;

  for (let path = 0; path < pathCount; path += 1) {
    const alignment = directionalComponent(
      field.perLineGuideX[path][origin],
      field.perLineGuideY[path][origin],
      direction,
    );
    if (alignment === 0) continue;
    // amount <= capacity and alignment <= Q, so the product is below 2^35.
    const contribution = ((amount * alignment) / totalAlignment) | 0;
    perPathFlow[path] = checkedAdd(perPathFlow[path], contribution, "perPathFlow");
  }
}

function proposeFlows(
  density,
  blockedMask,
  feedbackX,
  feedbackY,
  field,
  config,
  flows,
  incomingRequested,
  advectionScores,
  diffusionScores,
  fluxLimitedAmount,
  fluxLimitedEvents,
  conductanceStats,
  step,
) {
  flows.fill(0);
  incomingRequested.fill(0);
  if (advectionScores) advectionScores.fill(0);
  if (diffusionScores) diffusionScores.fill(0);
  const cellCount = density.length;

  for (let index = 0; index < cellCount; index += 1) {
    if (blockedMask[index] !== 0) continue;
    const amount = density[index];
    if (amount <= 0) continue;
    const activeGuide = clampVector(
      field.guideX[index] + feedbackX[index] + mulQ(field.restoreX[index], config.restoreWeight),
      field.guideY[index] + feedbackY[index] + mulQ(field.restoreY[index], config.restoreWeight),
      config.guideLimit,
    );
    const guideX = activeGuide[0];
    const guideY = activeGuide[1];
    const scores = [0, 0, 0, 0];
    const localAdvectionScores = advectionScores ? [0, 0, 0, 0] : null;
    const localDiffusionScores = diffusionScores ? [0, 0, 0, 0] : null;
    let scoreTotal = 0;

    for (let direction = 0; direction < 4; direction += 1) {
      const destination = neighborIndex(index, direction, config.width, config.height);
      if (destination < 0 && config.corridorBlocksOutOfField) continue;
      if (destination >= 0 && blockedMask[destination] !== 0) continue;
      if (destination >= 0 && (field.distance[destination] < 0 || field.distance[destination] > config.corridorWidth)) continue;
      const guideComponent = directionalComponent(guideX, guideY, direction);
      const destinationDensityForConductance = destination < 0 ? 0 : density[destination];
      const occupancyRaw = ((destinationDensityForConductance * Q) / config.congestionReference) | 0;
      const occupancy = occupancyRaw > Q ? Q : occupancyRaw;
      const conductance = Q - mulQ(config.congestionWeight, occupancy);
      const advectionScore = mulQ(mulQ(guideComponent, config.advectionWeight), conductance);
      if (conductanceStats) {
        if (conductance < conductanceStats.min) {
          conductanceStats.min = conductance; conductanceStats.cell = destination < 0 ? index : destination; conductanceStats.step = step;
        }
        if (conductance < (Q >> 1)) conductanceStats.throttled += 1;
      }
      // The absorbing exterior has fixed zero density. This creates an outward
      // diffusion gradient even where no guide reaches the boundary, removing
      // the reflecting-wall behavior by an explicit deterministic rule.
      const destinationDensity = destination < 0 ? 0 : density[destination];
      const densityDifference = amount - destinationDensity;
      const gradientComponent = densityDifference > 0 ? densityDifference : 0;
      const diffusionScore = mulQ(gradientComponent, config.diffusionWeight);
      const score = checkedAdd(advectionScore, diffusionScore, "direction score");
      scores[direction] = score;
      if (localAdvectionScores) localAdvectionScores[direction] = advectionScore;
      if (localDiffusionScores) localDiffusionScores[direction] = diffusionScore;
      scoreTotal += score;
    }
    if (scoreTotal <= 0) continue;

    const budget = mulQ(amount, config.transferRate);
    for (let direction = 0; direction < 4; direction += 1) {
      const score = scores[direction];
      if (score === 0) continue;
      // budget <= capacity and scoreTotal is bounded by 8*Q; product < 2^40.
      const proposed = ((budget * score) / scoreTotal) | 0;
      let accepted = proposed;
      // The edge limit applies after score allocation and before the existing
      // destination-capacity limit. Suppressed density therefore stays at origin.
      if (accepted > config.edgeFluxMax) {
        accepted = config.edgeFluxMax;
        if (fluxLimitedAmount) {
          addUnsigned64(fluxLimitedAmount, proposed - accepted);
          addUnsigned64(fluxLimitedEvents, 1);
        }
      }
      if (accepted <= 0) continue;
      const destination = neighborIndex(index, direction, config.width, config.height);
      const flowIndex = index * 4 + direction;
      flows[flowIndex] = accepted;
      if (advectionScores) advectionScores[flowIndex] = localAdvectionScores[direction];
      if (diffusionScores) diffusionScores[flowIndex] = localDiffusionScores[direction];
      if (destination >= 0) {
        incomingRequested[destination] = checkedAdd(incomingRequested[destination], accepted, "incoming request");
      }
    }
  }
}

function applyCapacity(density, capacity, config, flows, incomingRequested, outOfFieldByEdge) {
  let stagnation = 0;
  let outOfField = 0;
  const cellCount = density.length;
  for (let origin = 0; origin < cellCount; origin += 1) {
    for (let direction = 0; direction < 4; direction += 1) {
      const flowIndex = origin * 4 + direction;
      const proposed = flows[flowIndex];
      if (proposed === 0) continue;
      const destination = neighborIndex(origin, direction, config.width, config.height);
      if (destination < 0) {
        outOfField = checkedAdd(outOfField, proposed, "step outOfField");
        if (outOfFieldByEdge) {
          const edgeNames = ["top", "right", "bottom", "left"];
          const edge = edgeNames[direction];
          outOfFieldByEdge[edge] = checkedAdd(outOfFieldByEdge[edge], proposed, `outOfFieldByEdge.${edge}`);
        }
        continue;
      }
      const remaining = capacity[destination] - density[destination];
      const requested = incomingRequested[destination];
      if (remaining >= requested) continue;
      const accepted = remaining <= 0 ? 0 : ((proposed * remaining) / requested) | 0;
      flows[flowIndex] = accepted;
      stagnation = checkedAdd(stagnation, proposed - accepted, "step stagnation");
    }
  }
  return [stagnation, outOfField];
}

function writeNextDensity(
  read,
  write,
  flows,
  blockedMask,
  config,
  field,
  perPathFlow,
  advectionScores,
  diffusionScores,
  advectionMoved,
  diffusionMoved,
  totalMoved,
) {
  const cellCount = read.length;
  for (let index = 0; index < cellCount; index += 1) {
    if (blockedMask[index] !== 0) {
      write[index] = 0;
      continue;
    }
    let value = read[index];
    for (let direction = 0; direction < 4; direction += 1) {
      const amount = flows[index * 4 + direction];
      value -= amount;
      if (amount > 0) {
        allocatePathFlow(amount, index, direction, field, perPathFlow);
        if (advectionScores) {
          const flowIndex = index * 4 + direction;
          const advectionScore = advectionScores[flowIndex];
          const combinedScore = advectionScore + diffusionScores[flowIndex];
          const advectionAmount = combinedScore > 0 ? ((amount * advectionScore) / combinedScore) | 0 : 0;
          // Any truncation remainder is assigned to diffusion by this fixed rule.
          const diffusionAmount = amount - advectionAmount;
          addUnsigned64(advectionMoved, advectionAmount);
          addUnsigned64(diffusionMoved, diffusionAmount);
          addUnsigned64(totalMoved, amount);
        }
      }
    }

    for (let direction = 0; direction < 4; direction += 1) {
      const origin = neighborIndex(index, direction, config.width, config.height);
      if (origin < 0) continue;
      const incomingDirection = (direction + 2) & 3;
      value += flows[origin * 4 + incomingDirection];
    }
    write[index] = value | 0;
  }
}

function measureGapThroughput(flows, gapMap, accumulators, config) {
  const originX = 31;
  const direction = 1;
  for (let y = 0; y < config.height; y += 1) {
    const origin = y * config.width + originX;
    const destination = origin + 1;
    const gapIndex = gapMap[destination] - 1;
    if (gapIndex < 0) continue;
    addUnsigned64(accumulators[gapIndex], flows[origin * 4 + direction]);
  }
}

function writeNextFeedback(density, readX, readY, writeX, writeY, field, config) {
  let backflowEvents = 0;
  for (let index = 0; index < density.length; index += 1) {
    const decayedX = mulQ(readX[index], config.reverseDamping);
    const decayedY = mulQ(readY[index], config.reverseDamping);
    if (density[index] > config.reverseThreshold) {
      backflowEvents += 1;
      const active = clampVector(
        field.guideX[index] + readX[index],
        field.guideY[index] + readY[index],
        config.guideLimit,
      );
      const next = clampVector(
        decayedX - mulQ(active[0], config.reverseStrength),
        decayedY - mulQ(active[1], config.reverseStrength),
        config.reverseLimit,
      );
      writeX[index] = next[0];
      writeY[index] = next[1];
    } else {
      writeX[index] = decayedX;
      writeY[index] = decayedY;
    }
  }
  return backflowEvents | 0;
}

export function runSimulation({
  lines,
  source,
  sink,
  sinkGroups,
  blocked = [],
  gaps = [],
  seed,
  config: configOverrides = {},
  measure = false,
}) {
  if (!Number.isInteger(seed)) throw new TypeError("seed must be an integer");
  const config = createConfig(configOverrides);
  const sourceIndices = cellIndices(source, config, "source");
  const sinkIndices = cellIndices(sink, config, "sink");
  const blockedCells = createBlockedMask(blocked, config);
  const gapMap = createGapMap(gaps, blockedCells.mask, config);
  const sinkGroupMap = createSinkGroupMap(sinkGroups, sinkIndices, config);
  for (let index = 0; index < sourceIndices.length; index += 1) {
    if (blockedCells.mask[sourceIndices[index]] !== 0) throw new RangeError("source cells must not be blocked");
  }
  for (let index = 0; index < sinkIndices.length; index += 1) {
    if (blockedCells.mask[sinkIndices[index]] !== 0) throw new RangeError("sink cells must not be blocked");
  }
  const sourceExclusion = createSourceExclusion(source, config);
  const field = burnLines(lines, config);
  const restoreField = buildRestoreField(field.lineMask, blockedCells.mask, config);
  field.restoreX = restoreField.restoreX;
  field.restoreY = restoreField.restoreY;
  field.distance = restoreField.distance;
  const cellCount = config.width * config.height;
  let densityRead = new Int32Array(cellCount);
  let densityWrite = new Int32Array(cellCount);
  let feedbackReadX = new Int32Array(cellCount);
  let feedbackReadY = new Int32Array(cellCount);
  let feedbackWriteX = new Int32Array(cellCount);
  let feedbackWriteY = new Int32Array(cellCount);
  const capacity = new Int32Array(cellCount);
  capacity.fill(config.capacity);
  for (let index = 0; index < cellCount; index += 1) {
    if (blockedCells.mask[index] !== 0) capacity[index] = 0;
  }
  const flows = new Int32Array(cellCount * 4);
  const incomingRequested = new Int32Array(cellCount);
  const advectionScores = measure ? new Int32Array(cellCount * 4) : null;
  const diffusionScores = measure ? new Int32Array(cellCount * 4) : null;
  const perPathFlow = new Int32Array(lines.length);
  let totalCompleted = 0;
  let completionStep = -1;
  let maxStagnation = 0;
  let totalInjected = 0;
  let densityMax = 0;
  let densityMaxCell = null;
  let densityMaxStep = -1;
  let densityMaxSourceDistance = -1;
  let densityMaxExSource = 0;
  let densityMaxExSourceCell = null;
  let densityMaxExSourceStep = -1;
  let densityMaxExSourceSourceDistance = -1;
  let occupiedCellsPeak = 0;
  let backflowEvents = 0;
  const totalResidency = new Uint32Array(2);
  const advectionMoved = new Uint32Array(2);
  const diffusionMoved = new Uint32Array(2);
  const totalMoved = new Uint32Array(2);
  const fluxLimitedAmount = measure ? new Uint32Array(2) : null;
  const fluxLimitedEvents = measure ? new Uint32Array(2) : null;
  const capacityLimitedAmount = measure ? new Uint32Array(2) : null;
  const sourceOutflow = measure ? new Uint32Array(2) : null;
  const conductanceStats = measure ? { min: Q, cell: -1, step: -1, throttled: 0 } : null;
  const outOfFieldByEdge = measure ? { left: 0, right: 0, top: 0, bottom: 0 } : null;
  const gapThroughput = measure ? gapMap.names.map(() => new Uint32Array(2)) : null;
  const sinkThroughput = measure && sinkGroupMap ? sinkGroupMap.names.map(() => new Uint32Array(2)) : null;
  const sinkFirstArrivalStep = measure && sinkGroupMap ? new Int32Array(sinkGroupMap.names.length).fill(-1) : null;
  const timeline = measure && config.sampleInterval > 0 ? [] : null;
  let sourcePositiveScoreDirections = 0;
  let sourcePositiveScoreDirectionsStep = -1;
  const maximumGuideMagnitude = measure ? guideMagnitudeMax(field) : 0;
  let outOfField = 0;
  let corridorEdgeDensityPeak = 0;
  let corridorEdgeDensityPeakCell = null;
  let fieldEdgeDensityPeak = 0;
  let fieldEdgeDensityPeakCell = null;
  let blockedFrontDensityPeak = blockedCells.count === 0 ? null : 0;
  let blockedFrontDensityPeakCell = null;
  const injectionBase = (config.injectionPerStep / sourceIndices.length) | 0;
  const injectionRemainder = config.injectionPerStep - injectionBase * sourceIndices.length;

  for (let step = 1; step <= config.steps; step += 1) {
    let injectedThisStep = 0;
    for (let sourceOffset = 0; sourceOffset < sourceIndices.length; sourceOffset += 1) {
      const sourceIndex = sourceIndices[sourceOffset];
      const requested = injectionBase + (sourceOffset < injectionRemainder ? 1 : 0);
      const remainingAtSource = capacity[sourceIndex] - densityRead[sourceIndex];
      const injected = remainingAtSource < requested ? (remainingAtSource > 0 ? remainingAtSource : 0) : requested;
      densityRead[sourceIndex] = checkedAdd(densityRead[sourceIndex], injected, "source density");
      injectedThisStep = checkedAdd(injectedThisStep, injected, "step injection");
    }
    totalInjected = checkedAdd(totalInjected, injectedThisStep, "totalInjected");
    let stepStagnation = config.injectionPerStep - injectedThisStep;
    if (measure) {
      for (let index = 0; index < cellCount; index += 1) {
        const amount = densityRead[index];
        const x = index % config.width;
        const y = (index / config.width) | 0;
        const sourceDistance = nearestSourceDistance(x, y, source);
        // Strict comparison keeps the first maximum in step/index iteration order.
        if (amount > densityMax) {
          densityMax = amount;
          densityMaxCell = [x, y];
          densityMaxStep = step;
          densityMaxSourceDistance = sourceDistance;
        }
        // Exclude every source and the union of their Manhattan-distance-1 neighbors.
        if (sourceExclusion.excluded[index] === 0 && amount > densityMaxExSource) {
          densityMaxExSource = amount;
          densityMaxExSourceCell = [x, y];
          densityMaxExSourceStep = step;
          densityMaxExSourceSourceDistance = sourceDistance;
        }
        if (field.distance[index] === config.corridorWidth && amount > corridorEdgeDensityPeak) {
          corridorEdgeDensityPeak = amount;
          corridorEdgeDensityPeakCell = [x, y, step];
        }
      }
      const fieldEdge = measureFieldEdgeDensity(densityRead, config);
      if (fieldEdge.maximum > fieldEdgeDensityPeak) {
        fieldEdgeDensityPeak = fieldEdge.maximum;
        fieldEdgeDensityPeakCell = [...fieldEdge.maximumCell, step];
      }
      const blockedFront = measureBlockedFrontDensity(densityRead, blockedCells.mask, blockedCells.count, config);
      if (blockedFront.maximum !== null && blockedFront.maximum > blockedFrontDensityPeak) {
        blockedFrontDensityPeak = blockedFront.maximum;
        blockedFrontDensityPeakCell = [...blockedFront.maximumCell, step];
      }
    }

    proposeFlows(
      densityRead,
      blockedCells.mask,
      feedbackReadX,
      feedbackReadY,
      field,
      config,
      flows,
      incomingRequested,
      advectionScores,
      diffusionScores,
      fluxLimitedAmount,
      fluxLimitedEvents,
      conductanceStats,
      step,
    );
    const [capacityLimitedThisStep, outOfFieldThisStep] = applyCapacity(
      densityRead,
      capacity,
      config,
      flows,
      incomingRequested,
      outOfFieldByEdge,
    );
    outOfField = checkedAdd(outOfField, outOfFieldThisStep, "outOfField");
    if (measure) {
      addUnsigned64(capacityLimitedAmount, capacityLimitedThisStep);
      measureGapThroughput(flows, gapMap.cellToGap, gapThroughput, config);
      let positiveDirections = 0;
      for (let sourceOffset = 0; sourceOffset < sourceIndices.length; sourceOffset += 1) {
        const sourceIndex = sourceIndices[sourceOffset];
        for (let direction = 0; direction < 4; direction += 1) {
          const flowIndex = sourceIndex * 4 + direction;
          addUnsigned64(sourceOutflow, flows[flowIndex]);
          if (advectionScores[flowIndex] > 0 || diffusionScores[flowIndex] > 0) positiveDirections += 1;
        }
      }
      // The final simulated step is the representative step reported below.
      sourcePositiveScoreDirections = positiveDirections;
      sourcePositiveScoreDirectionsStep = step;
    }
    stepStagnation = checkedAdd(
      stepStagnation,
      capacityLimitedThisStep,
      "step stagnation",
    );
    writeNextDensity(
      densityRead,
      densityWrite,
      flows,
      blockedCells.mask,
      config,
      field,
      perPathFlow,
      advectionScores,
      diffusionScores,
      advectionMoved,
      diffusionMoved,
      totalMoved,
    );

    let completedThisStep = 0;
    for (let sinkOffset = 0; sinkOffset < sinkIndices.length; sinkOffset += 1) {
      const sinkIndex = sinkIndices[sinkOffset];
      const arrived = densityWrite[sinkIndex];
      completedThisStep = checkedAdd(completedThisStep, arrived, "step completion");
      if (sinkThroughput !== null) {
        const groupIndex = sinkGroupMap.cellToGroup[sinkIndex] - 1;
        addUnsigned64(sinkThroughput[groupIndex], arrived);
        if (arrived > 0 && sinkFirstArrivalStep[groupIndex] === -1) sinkFirstArrivalStep[groupIndex] = step;
      }
      densityWrite[sinkIndex] = 0;
    }
    if (completedThisStep > 0) {
      totalCompleted = checkedAdd(totalCompleted, completedThisStep, "totalCompleted");
      if (completionStep === -1 && totalCompleted >= config.completionTarget) completionStep = step;
    }
    if (stepStagnation > maxStagnation) maxStagnation = stepStagnation;

    if (measure) {
      let occupiedCells = 0;
      let residentAmount = 0;
      for (let index = 0; index < cellCount; index += 1) {
        const amount = densityWrite[index];
        if (amount > 0) occupiedCells += 1;
        residentAmount = checkedAdd(residentAmount, amount, "resident amount");
      }
      if (occupiedCells > occupiedCellsPeak) occupiedCellsPeak = occupiedCells;
      addUnsigned64(totalResidency, residentAmount);
      if (timeline !== null && (step % config.sampleInterval === 0 || step === config.steps)) {
        let densityMaximumExSource = 0;
        for (let index = 0; index < cellCount; index += 1) {
          if (sourceExclusion.excluded[index] === 0 && densityWrite[index] > densityMaximumExSource) {
            densityMaximumExSource = densityWrite[index];
          }
        }
        const gapThroughputSample = {};
        for (let index = 0; index < gapMap.names.length; index += 1) {
          gapThroughputSample[gapMap.names[index]] = unsigned64ToSafeInteger(
            gapThroughput[index],
            `timeline[${timeline.length}].gapThroughput.${gapMap.names[index]}`,
          );
        }
        let sinkThroughputSample = null;
        if (sinkThroughput !== null) {
          sinkThroughputSample = {};
          for (let index = 0; index < sinkGroupMap.names.length; index += 1) {
            sinkThroughputSample[sinkGroupMap.names[index]] = unsigned64ToSafeInteger(
              sinkThroughput[index],
              `timeline[${timeline.length}].sinkThroughput.${sinkGroupMap.names[index]}`,
            );
          }
        }
        timeline.push({
          step,
          completed: totalCompleted,
          outOfField,
          remaining: residentAmount,
          gapThroughput: gapThroughputSample,
          ...(sinkThroughputSample === null ? {} : { sinkThroughput: sinkThroughputSample }),
          blockedFrontDensityMax: measureBlockedFrontDensity(
            densityWrite,
            blockedCells.mask,
            blockedCells.count,
            config,
          ).maximum,
          densityMaxExSource: densityMaximumExSource,
          occupiedCells,
        });
      }
    }

    const stepBackflowEvents = writeNextFeedback(
      densityWrite,
      feedbackReadX,
      feedbackReadY,
      feedbackWriteX,
      feedbackWriteY,
      field,
      config,
    );
    if (measure) backflowEvents = checkedAdd(backflowEvents, stepBackflowEvents, "backflowEvents");

    [densityRead, densityWrite] = [densityWrite, densityRead];
    [feedbackReadX, feedbackWriteX] = [feedbackWriteX, feedbackReadX];
    [feedbackReadY, feedbackWriteY] = [feedbackWriteY, feedbackReadY];
  }

  const result = {
    density: densityRead,
    stateHash: hashHex(densityRead),
    totalCompleted,
    completionStep,
    maxStagnation,
    perPathFlow: Array.from(perPathFlow),
  };
  if (measure) {
    let remainingAmount = 0;
    for (let index = 0; index < densityRead.length; index += 1) {
      remainingAmount = checkedAdd(remainingAmount, densityRead[index], "remaining amount");
    }
    const accountedAmount = checkedAdd(
      checkedAdd(totalCompleted, outOfField, "accounted amount"),
      remainingAmount,
      "accounted amount",
    );
    if (accountedAmount !== totalInjected) {
      throw new Error(`quantity conservation failed: injected=${totalInjected}, accounted=${accountedAmount}`);
    }
    let corridorEdgeDensityMax = 0;
    let corridorEdgeDensityMaxCell = null;
    let corridorEdgeDensityTotal = 0;
    let corridorEdgeCellCount = 0;
    let outsideCorridorCells = 0;
    const lineDistanceDensity = Array(65).fill(0);
    const lineDistanceCells = Array(65).fill(0);
    let lineDistanceUnreachable = 0;
    let lineDistanceUnreachableCells = 0;
    for (let index = 0; index < densityRead.length; index += 1) {
      const amount = densityRead[index];
      const distance = field.distance[index];
      if (distance < 0) {
        lineDistanceUnreachable = checkedAdd(lineDistanceUnreachable, amount, "line distance unreachable density");
        lineDistanceUnreachableCells += 1;
      } else {
        const distanceIndex = Math.min(distance, 64);
        lineDistanceDensity[distanceIndex] = checkedAdd(
          lineDistanceDensity[distanceIndex],
          amount,
          `line distance density ${distanceIndex}`,
        );
        lineDistanceCells[distanceIndex] += 1;
      }
      if (field.distance[index] < 0 || field.distance[index] > config.corridorWidth) {
        if (amount > 0) outsideCorridorCells += 1;
        continue;
      }
      if (field.distance[index] === config.corridorWidth) {
        corridorEdgeCellCount += 1;
        corridorEdgeDensityTotal = checkedAdd(corridorEdgeDensityTotal, amount, "corridor edge density");
        if (amount > corridorEdgeDensityMax) {
          corridorEdgeDensityMax = amount;
          corridorEdgeDensityMaxCell = [index % config.width, (index / config.width) | 0];
        }
      }
    }
    if (outsideCorridorCells !== 0) {
      throw new Error(`outsideCorridorCells invariant failed: ${outsideCorridorCells}`);
    }
    if (corridorEdgeDensityMax > corridorEdgeDensityPeak) {
      corridorEdgeDensityPeak = corridorEdgeDensityMax;
      corridorEdgeDensityPeakCell = [...corridorEdgeDensityMaxCell, config.steps];
    }
    const fieldEdge = measureFieldEdgeDensity(densityRead, config);
    const blockedFront = measureBlockedFrontDensity(densityRead, blockedCells.mask, blockedCells.count, config);
    const advectionShare = percentageUnsigned64(advectionMoved, totalMoved);
    const sourceOutflowTotal = unsigned64ToSafeInteger(sourceOutflow, "sourceOutflow");
    const sigmaProfile = measureSigmaProfile(densityRead, config);
    const bandThreshold = Math.max(1, (densityMaxExSource / 100) | 0);
    const bandProfile = measureBandProfile(densityRead, config, bandThreshold);
    const sourceX = source.reduce((maximum, [x]) => Math.max(maximum, x), 0);
    const coherence = measureCoherenceLength(bandProfile.meanSegmentWidth, sourceX);
    const gapThroughputTotals = {};
    for (let index = 0; index < gapMap.names.length; index += 1) {
      gapThroughputTotals[gapMap.names[index]] = unsigned64ToSafeInteger(
        gapThroughput[index],
        `gapThroughput.${gapMap.names[index]}`,
      );
    }
    let sinkThroughputTotals = null;
    let sinkFirstArrivalStepTotals = null;
    if (sinkThroughput !== null) {
      sinkThroughputTotals = {};
      sinkFirstArrivalStepTotals = {};
      for (let index = 0; index < sinkGroupMap.names.length; index += 1) {
        const name = sinkGroupMap.names[index];
        sinkThroughputTotals[name] = unsigned64ToSafeInteger(sinkThroughput[index], `sinkThroughput.${name}`);
        sinkFirstArrivalStepTotals[name] = sinkFirstArrivalStep[index];
      }
    }
    result.measurements = {
      densityMax,
      densityMaxCell,
      densityMaxStep,
      densityMaxExSource,
      densityMaxExSourceCell,
      densityMaxExSourceStep,
      sourceDistance: {
        densityMax: densityMaxSourceDistance,
        densityMaxExSource: densityMaxExSourceSourceDistance,
      },
      densityMaxRatio: ((densityMax * 100) / config.capacity) | 0,
      occupiedCellsPeak,
      meanResidency: totalCompleted > 0 ? divideUnsigned64ByInt32(totalResidency, totalCompleted) : -1,
      backflowEvents,
      completionStep,
      maxStagnation,
      fluxLimitedAmount: unsigned64ToSafeInteger(fluxLimitedAmount, "fluxLimitedAmount"),
      fluxLimitedEvents: unsigned64ToSafeInteger(fluxLimitedEvents, "fluxLimitedEvents"),
      capacityLimitedAmount: unsigned64ToSafeInteger(capacityLimitedAmount, "capacityLimitedAmount"),
      sourceDensityFinal: sourceIndices.reduce((total, index) => checkedAdd(total, densityRead[index], "source density final"), 0),
      sourceCellCount: sourceIndices.length,
      sinkCellCount: sinkIndices.length,
      blockedCellCount: blockedCells.count,
      gapThroughput: gapThroughputTotals,
      sinkThroughput: sinkThroughputTotals,
      sinkFirstArrivalStep: sinkFirstArrivalStepTotals,
      sourceExclusionCellCount: sourceExclusion.count,
      injectionBase,
      injectionRemainder,
      sourceOutflowAverage: sourceOutflowTotal / config.steps,
      sourcePositiveScoreDirections,
      sourcePositiveScoreDirectionsStep,
      sigmaProfile,
      bandThreshold,
      bandCells: bandProfile.bandCells,
      segmentCount: bandProfile.segmentCount,
      meanSegmentWidth: bandProfile.meanSegmentWidth,
      w0: coherence.w0,
      coherenceLength: coherence.coherenceLength,
      coherenceLengthSigma: measureCoherenceLengthSigma(sigmaProfile, sourceX),
      totalCompleted,
      totalInjected,
      outOfField,
      outOfFieldByEdge,
      completionRatio: totalInjected > 0 ? ((totalCompleted * 100) / totalInjected) | 0 : 0,
      outOfFieldRatio: totalInjected > 0 ? ((outOfField * 100) / totalInjected) | 0 : 0,
      remainingRatio: totalInjected > 0 ? ((remainingAmount * 100) / totalInjected) | 0 : 0,
      advectionShare,
      diffusionShare: 100 - advectionShare,
      guideMagnitudeMax: maximumGuideMagnitude,
      conductanceMin: conductanceStats.min,
      conductanceMinCell: conductanceStats.cell < 0 ? null : [conductanceStats.cell % config.width, (conductanceStats.cell / config.width) | 0, conductanceStats.step],
      throttledEdgeCount: conductanceStats.throttled,
      corridorEdgeDensityMax,
      corridorEdgeDensityMaxCell,
      corridorEdgeDensityMean: corridorEdgeCellCount > 0 ? (corridorEdgeDensityTotal / corridorEdgeCellCount) | 0 : null,
      corridorEdgeDensityPeak,
      corridorEdgeDensityPeakCell,
      fieldEdgeDensityMax: fieldEdge.maximum,
      fieldEdgeDensityMaxCell: fieldEdge.maximumCell,
      fieldEdgeDensityPeak,
      fieldEdgeDensityPeakCell,
      blockedFrontDensityMax: blockedFront.maximum,
      blockedFrontDensityMaxCell: blockedFront.maximumCell,
      blockedFrontDensityPeak,
      blockedFrontDensityPeakCell,
      outsideCorridorCells,
      lineDistanceDensity,
      lineDistanceCells,
      lineDistanceUnreachable,
      lineDistanceUnreachableCells,
      timeline,
    };
  }
  return result;
}

export { Q };
