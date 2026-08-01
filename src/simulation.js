import { createConfig, Q } from "./config.js";
import { burnLines } from "./lines.js";
import { clampInt32, hashHex, mulQ } from "./fixed-point.js";

const DIRECTION_X = [0, 1, 0, -1];
const DIRECTION_Y = [-1, 0, 1, 0];

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

function neighborIndex(index, direction, width, height) {
  const x = index % width;
  const y = (index / width) | 0;
  const nextX = x + DIRECTION_X[direction];
  const nextY = y + DIRECTION_Y[direction];
  if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) return -1;
  return nextY * width + nextX;
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
  feedbackX,
  feedbackY,
  field,
  config,
  flows,
  incomingRequested,
  advectionScores,
  diffusionScores,
) {
  flows.fill(0);
  incomingRequested.fill(0);
  if (advectionScores) advectionScores.fill(0);
  if (diffusionScores) diffusionScores.fill(0);
  const cellCount = density.length;

  for (let index = 0; index < cellCount; index += 1) {
    const amount = density[index];
    if (amount <= 0) continue;
    const guideX = clampInt32(field.guideX[index] + feedbackX[index], -config.guideLimit, config.guideLimit);
    const guideY = clampInt32(field.guideY[index] + feedbackY[index], -config.guideLimit, config.guideLimit);
    const scores = [0, 0, 0, 0];
    const localAdvectionScores = advectionScores ? [0, 0, 0, 0] : null;
    const localDiffusionScores = diffusionScores ? [0, 0, 0, 0] : null;
    let scoreTotal = 0;

    for (let direction = 0; direction < 4; direction += 1) {
      const destination = neighborIndex(index, direction, config.width, config.height);
      if (destination < 0) continue;
      const guideComponent = directionalComponent(guideX, guideY, direction);
      const densityDifference = amount - density[destination];
      const gradientComponent = densityDifference > 0 ? densityDifference : 0;
      const advectionScore = mulQ(guideComponent, config.advectionWeight);
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
      if (proposed <= 0) continue;
      const destination = neighborIndex(index, direction, config.width, config.height);
      const flowIndex = index * 4 + direction;
      flows[flowIndex] = proposed;
      if (advectionScores) advectionScores[flowIndex] = localAdvectionScores[direction];
      if (diffusionScores) diffusionScores[flowIndex] = localDiffusionScores[direction];
      incomingRequested[destination] = checkedAdd(incomingRequested[destination], proposed, "incoming request");
    }
  }
}

function applyCapacity(density, capacity, config, flows, incomingRequested) {
  let stagnation = 0;
  const cellCount = density.length;
  for (let origin = 0; origin < cellCount; origin += 1) {
    for (let direction = 0; direction < 4; direction += 1) {
      const flowIndex = origin * 4 + direction;
      const proposed = flows[flowIndex];
      if (proposed === 0) continue;
      const destination = neighborIndex(origin, direction, config.width, config.height);
      const remaining = capacity[destination] - density[destination];
      const requested = incomingRequested[destination];
      if (remaining >= requested) continue;
      const accepted = remaining <= 0 ? 0 : ((proposed * remaining) / requested) | 0;
      flows[flowIndex] = accepted;
      stagnation = checkedAdd(stagnation, proposed - accepted, "step stagnation");
    }
  }
  return stagnation;
}

function writeNextDensity(
  read,
  write,
  flows,
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

function writeNextFeedback(density, readX, readY, writeX, writeY, field, config) {
  let backflowEvents = 0;
  for (let index = 0; index < density.length; index += 1) {
    const decayedX = mulQ(readX[index], config.reverseDamping);
    const decayedY = mulQ(readY[index], config.reverseDamping);
    if (density[index] > config.reverseThreshold) {
      backflowEvents += 1;
      const activeX = clampInt32(field.guideX[index] + readX[index], -config.guideLimit, config.guideLimit);
      const activeY = clampInt32(field.guideY[index] + readY[index], -config.guideLimit, config.guideLimit);
      writeX[index] = clampInt32(decayedX - mulQ(activeX, config.reverseStrength), -config.reverseLimit, config.reverseLimit);
      writeY[index] = clampInt32(decayedY - mulQ(activeY, config.reverseStrength), -config.reverseLimit, config.reverseLimit);
    } else {
      writeX[index] = decayedX;
      writeY[index] = decayedY;
    }
  }
  return backflowEvents | 0;
}

export function runSimulation({ lines, source, sink, seed, config: configOverrides = {}, measure = false }) {
  if (!Number.isInteger(seed)) throw new TypeError("seed must be an integer");
  const config = createConfig(configOverrides);
  const sourceIndex = cellIndex(source, config, "source");
  const sinkIndex = cellIndex(sink, config, "sink");
  const field = burnLines(lines, config);
  const cellCount = config.width * config.height;
  let densityRead = new Int32Array(cellCount);
  let densityWrite = new Int32Array(cellCount);
  let feedbackReadX = new Int32Array(cellCount);
  let feedbackReadY = new Int32Array(cellCount);
  let feedbackWriteX = new Int32Array(cellCount);
  let feedbackWriteY = new Int32Array(cellCount);
  const capacity = new Int32Array(cellCount);
  capacity.fill(config.capacity);
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
  let densityMaxExSource = 0;
  let occupiedCellsPeak = 0;
  let backflowEvents = 0;
  const totalResidency = new Uint32Array(2);
  const advectionMoved = new Uint32Array(2);
  const diffusionMoved = new Uint32Array(2);
  const totalMoved = new Uint32Array(2);
  const maximumGuideMagnitude = measure ? guideMagnitudeMax(field) : 0;
  const outOfField = 0;

  for (let step = 1; step <= config.steps; step += 1) {
    const remainingAtSource = capacity[sourceIndex] - densityRead[sourceIndex];
    const injected = remainingAtSource < config.injectionPerStep ? (remainingAtSource > 0 ? remainingAtSource : 0) : config.injectionPerStep;
    densityRead[sourceIndex] = checkedAdd(densityRead[sourceIndex], injected, "source density");
    totalInjected = checkedAdd(totalInjected, injected, "totalInjected");
    let stepStagnation = config.injectionPerStep - injected;
    if (measure) {
      for (let index = 0; index < cellCount; index += 1) {
        const amount = densityRead[index];
        if (amount > densityMax) densityMax = amount;
        const x = index % config.width;
        const y = (index / config.width) | 0;
        // Exclude the source and its in-bounds Manhattan-distance-1 neighbors.
        const sourceDistance = Math.abs(x - source[0]) + Math.abs(y - source[1]);
        if (sourceDistance > 1 && amount > densityMaxExSource) densityMaxExSource = amount;
      }
    }

    proposeFlows(
      densityRead,
      feedbackReadX,
      feedbackReadY,
      field,
      config,
      flows,
      incomingRequested,
      advectionScores,
      diffusionScores,
    );
    stepStagnation = checkedAdd(
      stepStagnation,
      applyCapacity(densityRead, capacity, config, flows, incomingRequested),
      "step stagnation",
    );
    writeNextDensity(
      densityRead,
      densityWrite,
      flows,
      config,
      field,
      perPathFlow,
      advectionScores,
      diffusionScores,
      advectionMoved,
      diffusionMoved,
      totalMoved,
    );

    const completedThisStep = densityWrite[sinkIndex];
    if (completedThisStep > 0) {
      totalCompleted = checkedAdd(totalCompleted, completedThisStep, "totalCompleted");
      densityWrite[sinkIndex] = 0;
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
    const advectionShare = percentageUnsigned64(advectionMoved, totalMoved);
    result.measurements = {
      densityMax,
      densityMaxExSource,
      densityMaxRatio: ((densityMax * 100) / config.capacity) | 0,
      occupiedCellsPeak,
      meanResidency: totalCompleted > 0 ? divideUnsigned64ByInt32(totalResidency, totalCompleted) : -1,
      backflowEvents,
      completionStep,
      maxStagnation,
      totalCompleted,
      totalInjected,
      completionRatio: totalInjected > 0 ? ((totalCompleted * 100) / totalInjected) | 0 : 0,
      outOfFieldRatio: totalInjected > 0 ? ((outOfField * 100) / totalInjected) | 0 : 0,
      remainingRatio: totalInjected > 0 ? ((remainingAmount * 100) / totalInjected) | 0 : 0,
      advectionShare,
      diffusionShare: 100 - advectionShare,
      guideMagnitudeMax: maximumGuideMagnitude,
    };
  }
  return result;
}

export { Q };
