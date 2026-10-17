import { worldToScreen } from "./iso";

/**
 * Placeholder battlefield renderer. Draws a deterministic isometric grid on a
 * 2D canvas so the shell has something to look at before the PixiJS renderer
 * (task T029) replaces it. No game state lives here.
 */
export interface Scene {
  dispose(): void;
}

const GRID = 12;
const TERRAIN = ["#6f8f4a", "#5c7d40", "#3f5f3a", "#8a7a5a", "#3d6f8f"] as const;

function terrainAt(gx: number, gy: number): (typeof TERRAIN)[number] {
  const n = (gx * 7 + gy * 13) % 23;
  if (n === 0) return TERRAIN[4];
  if (n < 3) return TERRAIN[3];
  if (n < 7) return TERRAIN[2];
  if (n < 13) return TERRAIN[1];
  return TERRAIN[0];
}

export function createScene(canvas: HTMLCanvasElement): Scene {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");

  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));

    // Size the backing store to device pixels; draw in CSS pixels.
    const backingWidth = Math.floor(width * dpr);
    const backingHeight = Math.floor(height * dpr);
    if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
      canvas.width = backingWidth;
      canvas.height = backingHeight;
    }
    draw(width, height);
  };

  const draw = (width: number, height: number) => {
    if (width <= 0 || height <= 0) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const tileW = Math.max(40, Math.min(72, width / 16));
    const tileH = tileW / 2;
    const originX = width / 2;
    const originY = height / 2 - (GRID * tileH) / 2;

    for (let gy = 0; gy < GRID; gy++) {
      for (let gx = 0; gx < GRID; gx++) {
        const { x, y } = worldToScreen(gx, gy, 0, tileW, tileH);
        const cx = originX + x;
        const cy = originY + y;
        ctx.beginPath();
        ctx.moveTo(cx, cy - tileH / 2);
        ctx.lineTo(cx + tileW / 2, cy);
        ctx.lineTo(cx, cy + tileH / 2);
        ctx.lineTo(cx - tileW / 2, cy);
        ctx.closePath();
        ctx.fillStyle = terrainAt(gx, gy);
        ctx.fill();
        ctx.strokeStyle = "rgba(20, 27, 40, 0.35)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    // Placeholder unit stands (two detachments facing off).
    const units: Array<[number, number, string]> = [
      [3, 4, "#2b4f9e"],
      [4, 5, "#2b4f9e"],
      [7, 2, "#9e2b2b"],
      [8, 3, "#9e2b2b"],
      [6, 8, "#2f6b45"],
    ];
    for (const [gx, gy, colour] of units) {
      const { x, y } = worldToScreen(gx, gy, 0, tileW, tileH);
      ctx.beginPath();
      ctx.arc(originX + x, originY + y - tileH * 0.35, tileH * 0.22, 0, Math.PI * 2);
      ctx.fillStyle = colour;
      ctx.fill();
      ctx.strokeStyle = "rgba(0, 0, 0, 0.5)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  };

  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  return {
    dispose() {
      observer.disconnect();
    },
  };
}
