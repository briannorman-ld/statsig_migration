import { useState } from 'react';
import { StartScreen } from './screens/StartScreen.tsx';
import { WorkspaceScreen } from './screens/WorkspaceScreen.tsx';

export type Route = { screen: 'start' } | { screen: 'workspace'; workspaceId: string };

export function App() {
  const [route, setRoute] = useState<Route>({ screen: 'start' });
  if (route.screen === 'workspace') return <WorkspaceScreen workspaceId={route.workspaceId} onExit={() => setRoute({ screen: 'start' })} />;
  return <StartScreen onOpen={(workspaceId) => setRoute({ screen: 'workspace', workspaceId })} />;
}
