export type RichContentType = 'latex' | 'markdown' | 'code' | 'image' | 'table';

export interface DetectedBlock {
  type: RichContentType;
  content: string;
  language?: string; // for code blocks
  display?: 'inline' | 'block'; // for LaTeX
  startLine: number;
  endLine: number;
}

export interface RichOutputItem {
  id: string;
  sessionId: string;
  type: RichContentType;
  content: string;
  language?: string;
  display?: 'inline' | 'block';
  html?: string; // rendered HTML
  timestamp: number;
}
