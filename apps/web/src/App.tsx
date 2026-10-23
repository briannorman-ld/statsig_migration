import { useEffect, useState } from 'react';
import { isLdTossEnabled, REVERSE_MIGRATION_HASH, useLdToss } from './lib/ldtoss.ts';
import { ReverseMigrationScreen } from './screens/ReverseMigration.tsx';
import { StartScreen } from './screens/StartScreen.tsx';
import { WorkspaceScreen } from './screens/WorkspaceScreen.tsx';

export type Route = { screen: 'start' } | { screen: 'workspace'; workspaceId: string } | { screen: 'toss' };

/**
 * The open workspace lives in the URL hash (`#/w/<id>`), so a refresh or a bookmark lands back in
 * it instead of on the start screen. Only the workspace id goes there: tokens never do, and the
 * hash is never sent to a server. LD and StatSig keys are memory-only, so after a refresh the
 * workspace reopens disconnected until the keys are entered again (PLAN §3.4).
 */
export function routeFromHash(hash: string): Route {
  // The reverse-migration easter egg (lib/ldtoss.ts). The route parses regardless; App decides
  // whether to show it, so a stale link with the gate off lands on the start screen.
  if (hash === REVERSE_MIGRATION_HASH) return { screen: 'toss' };
  const m = /^#\/w\/([A-Za-z0-9._-]+)$/.exec(hash);
  return m ? { screen: 'workspace', workspaceId: decodeURIComponent(m[1]!) } : { screen: 'start' };
}

export function hashForRoute(route: Route): string {
  if (route.screen === 'toss') return REVERSE_MIGRATION_HASH;
  return route.screen === 'workspace' ? `#/w/${encodeURIComponent(route.workspaceId)}` : '#/';
}

export function App() {
  const [route, setRouteState] = useState<Route>(() => routeFromHash(window.location.hash));
  const setRoute = (r: Route) => {
    setRouteState(r);
    const next = hashForRoute(r);
    if (window.location.hash !== next) window.history.pushState(null, '', next);
  };
  useEffect(() => {
    const onChange = () => setRouteState(routeFromHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    window.addEventListener('popstate', onChange);
    return () => {
      window.removeEventListener('hashchange', onChange);
      window.removeEventListener('popstate', onChange);
    };
  }, []);
  const toss = useLdToss();
  if (route.screen === 'toss') {
    if (toss || isLdTossEnabled()) return <ReverseMigrationScreen onExit={() => setRoute({ screen: 'start' })} />;
    return <StartScreen onOpen={(workspaceId) => setRoute({ screen: 'workspace', workspaceId })} />;
  }
  if (route.screen === 'workspace') return <WorkspaceScreen workspaceId={route.workspaceId} onExit={() => setRoute({ screen: 'start' })} />;
  return <StartScreen onOpen={(workspaceId) => setRoute({ screen: 'workspace', workspaceId })} />;
}
