
import { SupportedFormat } from '../types';

export const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result as string;
      const base64Data = base64String.split(',')[1];
      resolve(base64Data);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

export const formatBytes = (bytes: number, decimals = 2) => {
  if (!+bytes) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
};

// --- K-Means Color Quantization ---
interface Rgb { r: number; g: number; b: number; }

const getPixelColor = (data: Uint8ClampedArray, i: number): Rgb => ({
  r: data[i],
  g: data[i + 1],
  b: data[i + 2]
});

const colorDistance = (c1: Rgb, c2: Rgb) => {
  return Math.sqrt(
    Math.pow(c1.r - c2.r, 2) + 
    Math.pow(c1.g - c2.g, 2) + 
    Math.pow(c1.b - c2.b, 2)
  );
};

const rgbToHex = (c: Rgb) => {
  return "#" + ((1 << 24) + (c.r << 16) + (c.g << 8) + c.b).toString(16).slice(1);
};

// Simplified K-Means to find dominant colors
const extractPalette = (data: Uint8ClampedArray, pixelCount: number, k: number): Rgb[] => {
  // 1. Initialize centroids with random pixels
  let centroids: Rgb[] = [];
  const step = Math.floor(pixelCount / k);
  for (let i = 0; i < k; i++) {
    centroids.push(getPixelColor(data, (i * step) * 4));
  }

  // 2. Iterations (Increased to 5 for better color convergence)
  for (let iter = 0; iter < 5; iter++) {
    const sums = centroids.map(() => ({ r: 0, g: 0, b: 0, count: 0 }));
    
    // Sample pixels (every 4th pixel for speed)
    for (let i = 0; i < data.length; i += 16) { 
      const p = getPixelColor(data, i);
      let minDist = Infinity;
      let closestIndex = 0;
      
      for (let j = 0; j < k; j++) {
        const dist = colorDistance(p, centroids[j]);
        if (dist < minDist) {
          minDist = dist;
          closestIndex = j;
        }
      }
      
      sums[closestIndex].r += p.r;
      sums[closestIndex].g += p.g;
      sums[closestIndex].b += p.b;
      sums[closestIndex].count++;
    }

    // Update centroids
    for (let j = 0; j < k; j++) {
      if (sums[j].count > 0) {
        centroids[j] = {
          r: Math.floor(sums[j].r / sums[j].count),
          g: Math.floor(sums[j].g / sums[j].count),
          b: Math.floor(sums[j].b / sums[j].count)
        };
      }
    }
  }
  return centroids;
};

// --- Vector Tracing (Marching Squares w/ Bezier Smoothing) ---

// Maps Marching Squares case (0-15) to geometry edges
// [startEdge, endEdge] where edges are 0:Top, 1:Right, 2:Bottom, 3:Left
const LINE_LOOKUP: number[][][] = [
  [], // 0: Empty
  [[3, 2]], // 1: Bottom-Left
  [[2, 1]], // 2: Bottom-Right
  [[3, 1]], // 3: Bottom band
  [[1, 0]], // 4: Top-Right
  [[0, 3], [1, 2]], // 5: Saddle (Top-Left + Bottom-Right) -> Ambiguous, simplified
  [[2, 0]], // 6: Right band
  [[3, 0]], // 7: Not Top-Left (inverted corner)
  [[0, 3]], // 8: Top-Left
  [[0, 2]], // 9: Left band
  [[0, 1], [3, 2]], // 10: Saddle (Top-Right + Bottom-Left)
  [[0, 1]], // 11: Not Bottom-Right
  [[1, 3]], // 12: Top band
  [[1, 2]], // 13: Not Bottom-Left
  [[2, 3]], // 14: Not Top-Right
  []  // 15: Full
];

interface Point { x: number; y: number; }

const traceLayer = (
  width: number, 
  height: number, 
  isColorFunc: (x: number, y: number) => boolean
): string => {
  const visited = new Set<string>();
  let pathData = "";

  // Helper to interpolate position (midpoints for 0/1 grid)
  const getEdgePos = (x: number, y: number, edge: number): Point => {
    switch (edge) {
      case 0: return { x: x + 0.5, y: y };       // Top
      case 1: return { x: x + 1, y: y + 0.5 };   // Right
      case 2: return { x: x + 0.5, y: y + 1 };   // Bottom
      case 3: return { x: x, y: y + 0.5 };       // Left
      default: return { x, y };
    }
  };

  // Iterate grid cells (between pixels)
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const key = `${x},${y}`;
      if (visited.has(key)) continue;

      // Calculate Square Index
      // 8 4
      // 1 2
      let idx = 0;
      if (isColorFunc(x, y + 1)) idx |= 1;
      if (isColorFunc(x + 1, y + 1)) idx |= 2;
      if (isColorFunc(x + 1, y)) idx |= 4;
      if (isColorFunc(x, y)) idx |= 8;

      if (idx === 0 || idx === 15) continue; // Empty or Full, no edge here

      // Found a boundary, start tracing
      const lines = LINE_LOOKUP[idx];
      
      // Usually take the first segment found to start a loop
      if (lines.length > 0) {
        let points: Point[] = [];
        let currX = x;
        let currY = y;
        let startEdge = lines[0][0]; // Entry edge
        let nextEdge = lines[0][1]; // Exit edge
        
        // Safety Break
        let steps = 0;
        const maxSteps = width * height;

        // Start point
        points.push(getEdgePos(currX, currY, startEdge));

        while (steps < maxSteps) {
          visited.add(`${currX},${currY}`);
          points.push(getEdgePos(currX, currY, nextEdge));

          // Move to next cell based on exit edge
          if (nextEdge === 0) currY--;
          else if (nextEdge === 1) currX++;
          else if (nextEdge === 2) currY++;
          else if (nextEdge === 3) currX--;

          // Calculate index of new cell
          if (currX < 0 || currX >= width - 1 || currY < 0 || currY >= height - 1) break;

          let nIdx = 0;
          if (isColorFunc(currX, currY + 1)) nIdx |= 1;
          if (isColorFunc(currX + 1, currY + 1)) nIdx |= 2;
          if (isColorFunc(currX + 1, currY)) nIdx |= 4;
          if (isColorFunc(currX, currY)) nIdx |= 8;
          
          if (nIdx === 0 || nIdx === 15) break;

          // Find the connection (where did we come from?)
          // Coming from Bottom (Edge 2 of prev) -> Enter Top (Edge 0) of curr
          const arrivalEdge = (nextEdge + 2) % 4; 
          
          const nextLines = LINE_LOOKUP[nIdx];
          const segment = nextLines.find(s => s[0] === arrivalEdge);
          
          if (!segment) break; // Should not happen in closed loops
          
          startEdge = segment[0];
          nextEdge = segment[1];
          
          // Check if loop closed
          if (currX === x && currY === y && startEdge === lines[0][0]) {
             break;
          }
          steps++;
        }

        // Convert points to Path Data with Quadratic Bezier Smoothing (Corner Cutting)
        if (points.length > 2) {
          const len = points.length;
          
          // Start at the midpoint of the last segment to ensure smooth closure
          const lastP = points[len - 1];
          const firstP = points[0];
          const startX = (lastP.x + firstP.x) / 2;
          const startY = (lastP.y + firstP.y) / 2;

          pathData += `M ${startX} ${startY} `;

          // Iterate through all points, using them as control points for curves
          for (let i = 0; i < len; i++) {
             const curr = points[i];
             const next = points[(i + 1) % len];
             
             // Midpoint of the next segment becomes the end point of this curve
             const midX = (curr.x + next.x) / 2;
             const midY = (curr.y + next.y) / 2;
             
             // Draw curve from previous midpoint (current position) 
             // to next midpoint, using the corner vertex (curr) as control
             pathData += `Q ${curr.x} ${curr.y} ${midX} ${midY} `;
          }
          
          pathData += "Z ";
        }
      }
    }
  }
  return pathData;
};


export const processImageClientSide = async (
  file: File, 
  format: SupportedFormat, 
  quality: number,
  scale: number,
  isVector: boolean = false,
  colorCount: number = 8
): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    
    img.onload = () => {
      URL.revokeObjectURL(url);
      
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      
      if (!ctx) {
        reject(new Error('Canvas context unavailable'));
        return;
      }

      let targetWidth = Math.floor(img.width * scale);
      let targetHeight = Math.floor(img.height * scale);

      // Limit vector resolution to avoid browser hang on trace
      if (isVector) {
        const maxVectorDimension = 1024; // Increased slightly for better detail
        if (targetWidth > maxVectorDimension || targetHeight > maxVectorDimension) {
           const ratio = Math.min(maxVectorDimension / targetWidth, maxVectorDimension / targetHeight);
           targetWidth = Math.floor(targetWidth * ratio);
           targetHeight = Math.floor(targetHeight * ratio);
        }
      }

      canvas.width = targetWidth;
      canvas.height = targetHeight;
      ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

      if (isVector) {
        const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
        const data = imageData.data;
        
        // 1. Extract Palette (Preserve Original Colors)
        const palette = extractPalette(data, targetWidth * targetHeight, colorCount);

        // 2. Map pixels to closest palette color index
        const colorIndices = new Uint8Array(targetWidth * targetHeight);
        for (let i = 0; i < data.length; i += 4) {
           const p = { r: data[i], g: data[i+1], b: data[i+2] };
           let closest = 0;
           let min = Infinity;
           for (let c = 0; c < palette.length; c++) {
              const d = colorDistance(p, palette[c]);
              if (d < min) { min = d; closest = c; }
           }
           colorIndices[i / 4] = closest;
        }

        // 3. Generate SVG
        let svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${targetWidth} ${targetHeight}">`;
        
        // Background (optional, use first dominant color)
        svgContent += `<rect width="100%" height="100%" fill="${rgbToHex(palette[0])}"/>`;

        // Trace paths for each color (skip first if used as bg, but layer order matters)
        for (let c = 0; c < palette.length; c++) {
          const hex = rgbToHex(palette[c]);
          
          // Function to check if pixel at x,y matches current color
          const isColor = (x: number, y: number) => {
            if (x < 0 || y < 0 || x >= targetWidth || y >= targetHeight) return false;
            return colorIndices[y * targetWidth + x] === c;
          };

          const d = traceLayer(targetWidth, targetHeight, isColor);
          if (d.length > 0) {
            svgContent += `<path d="${d}" fill="${hex}" />`;
          }
        }

        svgContent += `</svg>`;
        resolve(new Blob([svgContent], { type: 'image/svg+xml' }));
        return;
      }

      // --- Standard Raster Output ---
      // For raster, we might want to retain smooth scaling
      if (!isVector) {
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
      }

      if (format === 'image/jpeg') {
        // Handle transparency for JPEG
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = targetWidth;
        tempCanvas.height = targetHeight;
        const tempCtx = tempCanvas.getContext('2d');
        if (tempCtx) {
            tempCtx.fillStyle = '#FFFFFF';
            tempCtx.fillRect(0, 0, targetWidth, targetHeight);
            tempCtx.drawImage(canvas, 0, 0);
            tempCanvas.toBlob(
                (blob) => blob ? resolve(blob) : reject(new Error('Conversion failed')),
                format,
                quality
            );
            return;
        }
      }

      canvas.toBlob(
        (blob) => blob ? resolve(blob) : reject(new Error('Conversion failed')),
        format,
        quality
      );
    };
    
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = url;
  });
};
