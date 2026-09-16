import { useEffect } from 'react';
import { startDefaultApplication } from '../bootstrap/defaultApplication';

/** 应用级生命周期只在 App 组件挂载一次。 */
export function useAppBootstrap(): void {
  useEffect(() => startDefaultApplication(), []);
}
