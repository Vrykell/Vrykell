import React from 'react';
import { Shell } from './app/Shell';

/**
 * Root component — thin mount layer. All layout, lifecycle, and event
 * wiring lives in app/Shell and its hooks.
 */
const App: React.FC = () => {
  return <Shell />;
};

export default App;
