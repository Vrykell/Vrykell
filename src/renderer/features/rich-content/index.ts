// Public entry point for the rich-content feature.
// Pipeline (pure detection + renderers) and UI (panel + hook).

export { detectRichContent, detectFirstBlock } from './pipeline/detector';
export type { DetectionResult } from './pipeline/detector';
export { LatexRenderer } from './pipeline/renderers/Latex';
export { MarkdownRenderer } from './pipeline/renderers/Markdown';
export { CodeBlock } from './pipeline/renderers/Code';

export { RichOutput } from './ui/RichOutput';
export { useRichContent } from './ui/hooks/useRichContent';
