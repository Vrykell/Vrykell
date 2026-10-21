import { createContext, useContext } from 'react';

export const AiSurfaceContext = createContext<Record<'main' | 'side' | 'native', (element: HTMLDivElement | null) => void> | null>(null);

export default function NativeConversationSurface({ active = true }: { active?: boolean }) {
  const context = useContext(AiSurfaceContext);
  return <div className="ai-native-surface" style={{ display: active ? 'flex' : 'none' }} ref={context?.native} />;
}
