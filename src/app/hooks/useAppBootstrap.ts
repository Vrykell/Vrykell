import { useEffect } from 'react';
import { startDefaultApplication } from '@app/bootstrap/defaultApplication';

/** Application-level lifecycle work runs once, when the app component mounts. */
export function useAppBootstrap(): void {
  useEffect(() => startDefaultApplication(), []);
}
