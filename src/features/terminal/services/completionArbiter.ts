export interface CompletionProvider<Candidate> { id: 'builtin' | 'shell' | 'path'; complete: () => Promise<Candidate[]> }
export async function resolveCompletion<Candidate>(providers: CompletionProvider<Candidate>[], isCurrent: () => boolean) {
  for (const provider of providers) {
    if (!isCurrent()) return null;
    let candidates: Candidate[];
    try { candidates = await provider.complete(); } catch { candidates = []; }
    if (!isCurrent()) return null;
    if (candidates.length) return { provider: provider.id, candidates };
  }
  return null;
}
