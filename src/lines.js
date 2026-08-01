import { Q } from "./config.js";
import { clampVector } from "./fixed-point.js";

function assertPoint(point, width, height) {
  if (!Array.isArray(point) || point.length !== 2) {
    throw new TypeError("each control point must be [x, y]");
  }
  if (!Number.isInteger(point[0]) || !Number.isInteger(point[1])) {
    throw new TypeError("control point coordinates must be integers");
  }
  if (point[0] < 0 || point[1] < 0 || point[0] >= width * Q || point[1] >= height * Q) {
    throw new RangeError("control point is outside the field");
  }
}

export function bilinearWeights(sampleX, sampleY) {
  const weightX = sampleX & 0xffff;
  const weightY = sampleY & 0xffff;
  const inverseX = Q - weightX;
  const inverseY = Q - weightY;
  // Division by Q is the exact arithmetic equivalent of >> 16 here. A JS
  // bitwise shift would first truncate the product to 32 bits when it is 2^32.
  let weight00 = ((inverseX * inverseY) / Q) | 0;
  const weight10 = ((weightX * inverseY) / Q) | 0;
  const weight01 = ((inverseX * weightY) / Q) | 0;
  const weight11 = ((weightX * weightY) / Q) | 0;
  weight00 += Q - weight00 - weight10 - weight01 - weight11;
  return [weight00 | 0, weight10, weight01, weight11];
}

function addSample(targetX, targetY, influence, width, height, sampleX, sampleY, vectorX, vectorY, radius) {
  const radiusCells = ((radius + Q - 1) / Q) | 0;
  const floorX = sampleX >> 16;
  const floorY = sampleY >> 16;
  const weights = bilinearWeights(sampleX, sampleY);
  const cornerX = [floorX, floorX + 1, floorX, floorX + 1];
  const cornerY = [floorY, floorY, floorY + 1, floorY + 1];
  const minY = floorY - radiusCells < 0 ? 0 : floorY - radiusCells;
  const maxY = floorY + radiusCells + 1 >= height ? height - 1 : floorY + radiusCells + 1;
  const minX = floorX - radiusCells < 0 ? 0 : floorX - radiusCells;
  const maxX = floorX + radiusCells + 1 >= width ? width - 1 : floorX + radiusCells + 1;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      let weight = 0;
      for (let corner = 0; corner < 4; corner += 1) {
        // A bilinear corner outside the field is discarded and its weight is
        // never renormalized or reassigned. This fixed rule prevents edge-order
        // dependent behavior while keeping every in-field update bounded.
        if (cornerX[corner] < 0 || cornerX[corner] >= width || cornerY[corner] < 0 || cornerY[corner] >= height) continue;
        const rawDeltaX = x - cornerX[corner];
        const rawDeltaY = y - cornerY[corner];
        const deltaX = (rawDeltaX < 0 ? -rawDeltaX : rawDeltaX) * Q;
        const deltaY = (rawDeltaY < 0 ? -rawDeltaY : rawDeltaY) * Q;
        const distance = deltaX > deltaY ? deltaX : deltaY;
        if (distance >= radius) continue;
        const radialWeight = (((radius - distance) * Q) / radius) | 0;
        weight += ((radialWeight * weights[corner]) / Q) | 0;
      }
      const index = y * width + x;
      if (weight <= influence[index]) continue;
      influence[index] = weight;
      targetX[index] = ((vectorX * weight) / Q) | 0;
      targetY[index] = ((vectorY * weight) / Q) | 0;
    }
  }
}

export function burnLines(lines, config) {
  if (!Array.isArray(lines) || lines.length < 3 || lines.length > 5) {
    throw new RangeError("lines must contain between 3 and 5 paths");
  }
  const cellCount = config.width * config.height;
  const guideX = new Int32Array(cellCount);
  const guideY = new Int32Array(cellCount);
  const perLineGuideX = new Array(lines.length);
  const perLineGuideY = new Array(lines.length);

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const points = lines[lineIndex];
    if (!Array.isArray(points) || points.length < 2) {
      throw new RangeError("each line needs at least two control points");
    }
    const lineX = new Int32Array(cellCount);
    const lineY = new Int32Array(cellCount);
    const influence = new Int32Array(cellCount);
    perLineGuideX[lineIndex] = lineX;
    perLineGuideY[lineIndex] = lineY;

    for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
      assertPoint(points[pointIndex], config.width, config.height);
    }

    for (let segment = 0; segment < points.length - 1; segment += 1) {
      const start = points[segment];
      const end = points[segment + 1];
      const deltaX = (end[0] - start[0]) | 0;
      const deltaY = (end[1] - start[1]) | 0;
      const extentX = Math.abs(deltaX);
      const extentY = Math.abs(deltaY);
      const extent = extentX > extentY ? extentX : extentY;
      if (extent === 0) continue;
      // extent <= 64*Q, so extent*Q <= 2^38 and is exactly representable.
      const vectorX = ((deltaX * Q) / extent) | 0;
      const vectorY = ((deltaY * Q) / extent) | 0;
      const samples = ((extent + (Q >> 2) - 1) / (Q >> 2)) | 0;
      for (let sample = 0; sample <= samples; sample += 1) {
        const sampleX = (start[0] + ((deltaX * sample) / samples) | 0) | 0;
        const sampleY = (start[1] + ((deltaY * sample) / samples) | 0) | 0;
        addSample(
          lineX,
          lineY,
          influence,
          config.width,
          config.height,
          sampleX,
          sampleY,
          vectorX,
          vectorY,
          config.burnRadius,
        );
      }
    }

    for (let index = 0; index < cellCount; index += 1) {
      const clamped = clampVector(
        guideX[index] + lineX[index],
        guideY[index] + lineY[index],
        config.guideLimit,
      );
      guideX[index] = clamped[0];
      guideY[index] = clamped[1];
    }
  }

  return { guideX, guideY, perLineGuideX, perLineGuideY };
}
