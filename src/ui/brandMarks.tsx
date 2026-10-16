/**
 * brandMarks — the vendor marks that identify the services a model list points at.
 *
 * The app ships no third-party asset: each mark is a simplified drawing made here, framed in the
 * same 24-unit box the icon set uses, filled with `currentColor` so a caller decides the hue (the
 * theme's `--brand-*` tokens where one exists, neutral ink otherwise). Marks read as references to
 * the named service, not as the vendor's official artwork.
 */
import { forwardRef } from 'react';
import type { AppIcon, AppIconProps } from './icons';

/** Solid "A" with the crossbar merged: the shape Anthropic is recognised by. */
export const AnthropicMark: AppIcon = forwardRef<SVGSVGElement, AppIconProps>(function AnthropicMark({ size = 24, style, ...props }, ref) {
  return (
    <svg ref={ref} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}
      style={{ width: size, height: size, flexShrink: 0, ...style }}>
      <path d="M12.4 3.2 20 20.8h-3.9l-3.7-9.1-3.7 9.1H4.8Z" />
      <path d="M7.8 14.2h9.1v3H7.8ZM15.5 14.2h1.4v3h-1.4Z" />
    </svg>
  );
});

/** Six woven petals: the knot OpenAI is recognised by. */
export const OpenAIMark: AppIcon = forwardRef<SVGSVGElement, AppIconProps>(function OpenAIMark({ size = 24, style, ...props }, ref) {
  return (
    <svg ref={ref} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" {...props}
      style={{ width: size, height: size, flexShrink: 0, ...style }}>
      {[0, 60, 120].map((angle) => (
        <ellipse key={angle} cx="12" cy="7.1" rx="2.9" ry="4.7" transform={`rotate(${angle} 12 12)`} />
      ))}
    </svg>
  );
});

/** Four-point star: the Gemini mark. */
export const GeminiMark: AppIcon = forwardRef<SVGSVGElement, AppIconProps>(function GeminiMark({ size = 24, style, ...props }, ref) {
  return (
    <svg ref={ref} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}
      style={{ width: size, height: size, flexShrink: 0, ...style }}>
      <path d="M12 2.2c1.05 6.2 3.55 8.7 9.8 9.8-6.25 1.05-8.75 3.55-9.8 9.8-1.05-6.25-3.55-8.75-9.8-9.8 6.25-1.1 8.75-3.6 9.8-9.8Z" />
    </svg>
  );
});

/** Diving whale: the DeepSeek mark. */
export const DeepSeekMark: AppIcon = forwardRef<SVGSVGElement, AppIconProps>(function DeepSeekMark({ size = 24, style, ...props }, ref) {
  return (
    <svg ref={ref} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}
      style={{ width: size, height: size, flexShrink: 0, ...style }}>
      <path d="M3 14.4c.4-3.7 3.5-6.2 7.3-6 3 .1 5.4 1.5 6.8 3.7l2.6-2.1c.5-.4 1.2.1.9.7l-1.6 4c-.3.9-1.1 1.4-2 1.4H9c-3.4 0-6.2-.1-6-1.7Z" />
      <path d="M6.6 10.9c1-1.5 2.5-2.4 4.3-2.3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
});

/** Crescent and star: the Moonshot (Kimi) mark. */
export const MoonshotMark: AppIcon = forwardRef<SVGSVGElement, AppIconProps>(function MoonshotMark({ size = 24, style, ...props }, ref) {
  return (
    <svg ref={ref} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}
      style={{ width: size, height: size, flexShrink: 0, ...style }}>
      <path d="M21 14.6A9.2 9.2 0 0 1 9.4 3 9.6 9.6 0 1 0 21 14.6Z" />
      <path d="M17.4 3.6l.7 1.75 1.75.7-1.75.7-.7 1.75-.7-1.75-1.75-.7 1.75-.7Z" />
    </svg>
  );
});

/** Stepped flag: the Mistral mark. */
export const MistralMark: AppIcon = forwardRef<SVGSVGElement, AppIconProps>(function MistralMark({ size = 24, style, ...props }, ref) {
  return (
    <svg ref={ref} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}
      style={{ width: size, height: size, flexShrink: 0, ...style }}>
      {[{ x: 1.6, y: 7.4 }, { x: 6, y: 4.2 }, { x: 10.4, y: 7.4 }, { x: 14.8, y: 4.2 }, { x: 19.2, y: 7.4 }]
        .map((bar) => <rect key={bar.x} x={bar.x} y={bar.y} width="3.2" height={19.6 - bar.y} />)}
    </svg>
  );
});

/** Double ring and bar: the Groq mark. */
export const GroqMark: AppIcon = forwardRef<SVGSVGElement, AppIconProps>(function GroqMark({ size = 24, style, ...props }, ref) {
  return (
    <svg ref={ref} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true" {...props}
      style={{ width: size, height: size, flexShrink: 0, ...style }}>
      <path d="M19.6 10.4A7.9 7.9 0 1 0 19.9 12" />
      <path d="M13.4 12h6.5" />
    </svg>
  );
});

/** Llama head: the Ollama mark. */
export const OllamaMark: AppIcon = forwardRef<SVGSVGElement, AppIconProps>(function OllamaMark({ size = 24, style, ...props }, ref) {
  return (
    <svg ref={ref} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}
      style={{ width: size, height: size, flexShrink: 0, ...style }}>
      <path d="M7.6 3.2 10 6.6H6.6ZM16.4 3.2 17.4 6.6h-3.4Z" />
      <path d="M12 5.2c3.6 0 5.8 2.4 5.8 5.8 0 1.2-.3 2.2-.7 3.1.5.5.7 1.2.7 1.9 0 2.6-2.5 4.6-5.8 4.6s-5.8-2-5.8-4.6c0-.7.2-1.4.7-1.9-.4-.9-.7-1.9-.7-3.1 0-3.4 2.2-5.8 5.8-5.8Z" />
    </svg>
  );
});

/** Crossed bars: the xAI (Grok) mark. */
export const XaiMark: AppIcon = forwardRef<SVGSVGElement, AppIconProps>(function XaiMark({ size = 24, style, ...props }, ref) {
  return (
    <svg ref={ref} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}
      style={{ width: size, height: size, flexShrink: 0, ...style }}>
      <path d="M5 4.4h3.6l10.4 15.2h-3.6Z" />
      <path d="M15.4 4.4H19L8.6 19.6H5Z" />
    </svg>
  );
});

/** Slanted zoetrope "Z": the Zhipu mark. */
export const ZhipuMark: AppIcon = forwardRef<SVGSVGElement, AppIconProps>(function ZhipuMark({ size = 24, style, ...props }, ref) {
  return (
    <svg ref={ref} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}
      style={{ width: size, height: size, flexShrink: 0, ...style }}>
      <path d="M5.6 5.2h12.8v2.4l-7.6 8.6h7.6v2.6H5.6v-2.4l7.6-8.6H5.6Z" />
    </svg>
  );
});

/** Ring and tail: the Qwen mark. */
export const QwenMark: AppIcon = forwardRef<SVGSVGElement, AppIconProps>(function QwenMark({ size = 24, style, ...props }, ref) {
  return (
    <svg ref={ref} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true" {...props}
      style={{ width: size, height: size, flexShrink: 0, ...style }}>
      <circle cx="12" cy="11.2" r="6.6" />
      <path d="M13.9 13.3 18.4 18" />
    </svg>
  );
});

/** Flowing "S" curve: the SiliconFlow mark. */
export const SiliconFlowMark: AppIcon = forwardRef<SVGSVGElement, AppIconProps>(function SiliconFlowMark({ size = 24, style, ...props }, ref) {
  return (
    <svg ref={ref} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true" {...props}
      style={{ width: size, height: size, flexShrink: 0, ...style }}>
      <path d="M18.8 6.2c-3.8-2.2-10-1.5-10 2 0 2.7 4.8 2.5 7.4 3.4 3.4 1.2 3 5.6-1.9 6.2-2.9.4-6.2-.5-8-2" />
    </svg>
  );
});

/** Split routing: the OpenRouter mark. */
export const OpenRouterMark: AppIcon = forwardRef<SVGSVGElement, AppIconProps>(function OpenRouterMark({ size = 24, style, ...props }, ref) {
  return (
    <svg ref={ref} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}
      style={{ width: size, height: size, flexShrink: 0, ...style }}>
      <circle cx="5.2" cy="12" r="2.3" />
      <circle cx="18.8" cy="6.4" r="2" />
      <circle cx="18.8" cy="17.6" r="2" />
      <path d="M7.2 11.1 16.9 6.9M7.2 12.9l9.7 4.2" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
});
