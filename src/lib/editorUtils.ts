import { CANVAS_HEIGHT, CANVAS_WIDTH, TERRAIN_PALETTE } from './constants';
import type { Bridge, Point } from './types';

export function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

export function rgbToHex(red: number, green: number, blue: number) {
  return `#${[red, green, blue].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

export function nearestTerrainHex(hex: string) {
  const [red, green, blue] = hexToRgb(hex);
  let best = TERRAIN_PALETTE[0];
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const terrain of TERRAIN_PALETTE) {
    const [terrainRed, terrainGreen, terrainBlue] = hexToRgb(terrain);
    const distance =
      (red - terrainRed) * (red - terrainRed) +
      (green - terrainGreen) * (green - terrainGreen) +
      (blue - terrainBlue) * (blue - terrainBlue);

    if (distance < bestDistance) {
      best = terrain;
      bestDistance = distance;
    }
  }

  return best;
}

export function quantizeCanvasContext(context: CanvasRenderingContext2D, width = CANVAS_WIDTH, height = CANVAS_HEIGHT) {
  const image = context.getImageData(0, 0, width, height);
  const { data } = image;

  for (let index = 0; index < data.length; index += 4) {
    const snapped = hexToRgb(nearestTerrainHex(rgbToHex(data[index], data[index + 1], data[index + 2])));
    data[index] = snapped[0];
    data[index + 1] = snapped[1];
    data[index + 2] = snapped[2];
    data[index + 3] = 255;
  }

  context.putImageData(image, 0, 0);
}

export function floodFillContext(context: CanvasRenderingContext2D, sx: number, sy: number, hex: string) {
  const image = context.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  const { data } = image;
  const startIndex = (sy * CANVAS_WIDTH + sx) * 4;
  const target = [data[startIndex], data[startIndex + 1], data[startIndex + 2], data[startIndex + 3]];
  const fill = hexToRgb(nearestTerrainHex(hex));

  if (target[0] === fill[0] && target[1] === fill[1] && target[2] === fill[2] && target[3] === 255) {
    return false;
  }

  const stack: Point[] = [[sx, sy]];

  while (stack.length > 0) {
    const [x, y] = stack.pop() as Point;
    if (x < 0 || y < 0 || x >= CANVAS_WIDTH || y >= CANVAS_HEIGHT) {
      continue;
    }

    const index = (y * CANVAS_WIDTH + x) * 4;
    if (
      data[index] !== target[0] ||
      data[index + 1] !== target[1] ||
      data[index + 2] !== target[2] ||
      data[index + 3] !== target[3]
    ) {
      continue;
    }

    data[index] = fill[0];
    data[index + 1] = fill[1];
    data[index + 2] = fill[2];
    data[index + 3] = 255;

    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }

  context.putImageData(image, 0, 0);
  return true;
}

export function drawDot(context: CanvasRenderingContext2D, point: { x: number; y: number }, size: number, color: string) {
  context.fillStyle = color;
  context.beginPath();
  context.arc(point.x, point.y, size / 2, 0, Math.PI * 2);
  context.fill();
}

export function drawSegment(
  context: CanvasRenderingContext2D,
  start: { x: number; y: number },
  end: { x: number; y: number },
  size: number,
  color: string,
) {
  context.strokeStyle = color;
  context.lineWidth = size;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.lineTo(end.x, end.y);
  context.stroke();
}

export function drawRect(
  context: CanvasRenderingContext2D,
  start: { x: number; y: number },
  end: { x: number; y: number },
  color: string,
) {
  context.fillStyle = color;
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);
  context.fillRect(x, y, width, height);
}

export function canvasPointFromEvent(canvas: HTMLCanvasElement, event: { clientX: number; clientY: number }) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: Math.round((event.clientX - rect.left) * (canvas.width / rect.width)),
    y: Math.round((event.clientY - rect.top) * (canvas.height / rect.height)),
  };
}

export function pointToSegmentDistance(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy || 1;
  let t = ((px - x1) * dx + (py - y1) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

export function bridgeEndpoints(bridge: Bridge) {
  return bridge;
}

export async function loadImageFromFile(file: File) {
  const objectUrl = URL.createObjectURL(file);

  try {
    const image = new Image();
    image.src = objectUrl;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Unable to read the image file.'));
    });
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function loadImageFromBase64(base64: string) {
  const image = new Image();
  image.src = `data:image/png;base64,${base64}`;
  await new Promise<void>((resolve) => {
    image.onload = () => resolve();
    image.onerror = () => resolve();
  });
  return image;
}