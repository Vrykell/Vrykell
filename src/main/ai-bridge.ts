import { EventEmitter } from 'events';
import { Message } from '../shared/types';

/**
 * AI SDK bridge for Claude API integration.
 * Phase 3 will implement full streaming chat with @anthropic-ai/sdk.
 */
export class AIBridge extends EventEmitter {
  private apiKey: string | null = null;
  private model = 'claude-sonnet-5-20251001';

  configure(apiKey: string, model?: string): void {
    this.apiKey = apiKey;
    if (model) this.model = model;
  }

  async chat(messages: Message[]): Promise<void> {
    if (!this.apiKey) {
      this.emit('error', new Error('AI API key not configured'));
      return;
    }

    // Phase 3: Implement real Claude API streaming
    // For now, return a placeholder response
    this.emit('response-chunk', 'AI chat will be implemented in Phase 3.');
    this.emit('response-done');
  }

  abort(): void {
    // Abort current streaming request
    this.emit('aborted');
  }
}
