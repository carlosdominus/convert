
export type SupportedFormat = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/avif' | 'image/svg+xml';

export interface ImageState {
  // Deprecated in favor of QueueItem for batch support, kept for reference if needed
  file: File | null;
  previewUrl: string | null;
  originalSize: number;
}

export interface QueueItem {
  id: string;
  file: File;
  previewUrl: string;
  originalSize: number;
  status: AppStatus;
  result?: ProcessedResult;
  error?: string;
}

export interface ConversionSettings {
  format: SupportedFormat;
  quality: number; // 0.1 to 1.0
  resizeRatio: number; // 0.1 to 1.0
  useAIAnalysis: boolean;
  isVector: boolean;
  colorCount: number; // 2 to 64
}

export interface ProcessedResult {
  blob: Blob;
  url: string;
  size: number;
  aiDescription?: string;
  aiTags?: string[];
}

export enum AppStatus {
  IDLE = 'IDLE',
  PROCESSING = 'PROCESSING',
  COMPLETE = 'COMPLETE',
  ERROR = 'ERROR'
}
