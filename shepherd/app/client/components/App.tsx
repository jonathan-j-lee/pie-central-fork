import * as React from 'react';
import { BrowserRouter as Router, Switch, Route, Redirect } from 'react-router-dom';
import { FocusStyleManager } from '@blueprintjs/core';

import Navigation from './Navigation';
import Scoreboard from './Scoreboard';
import Schedule from './Schedule';
import Leaderboard from './Leaderboard';
import Games from './Games';
import Dashboard from './Dashboard';
import { useAppSelector } from '../hooks';

FocusStyleManager.onlyShowFocusOnTabs();

export default function App() {
  const game = useAppSelector((state) => state.user.game);
  return (
    <Router>
      <Navigation />
      <main>
        <Switch>
          <Route path="/scoreboard">
            <Scoreboard />
          </Route>
          <Route path="/schedule">
            <Schedule />
          </Route>
          <Route path="/leaderboard">
            <Leaderboard />
          </Route>
          {game && (
            <Route path="/game">
              <Games game={game} />
            </Route>
          )}
          <Route path="/dashboard">
            <Dashboard />
          </Route>
          <Redirect exact from="*" to="/scoreboard" />
        </Switch>
      </main>
    </Router>
  );
}
