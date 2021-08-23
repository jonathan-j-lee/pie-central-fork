import * as React from 'react';
import { BrowserRouter as Router, Switch, Route, Redirect } from 'react-router-dom';
import { FocusStyleManager } from '@blueprintjs/core';

import Navigation from './Navigation';
import Scoreboard from './Scoreboard';
import Schedule from './Schedule';
import Game from './Game';
import Dashboard from './Dashboard';

FocusStyleManager.onlyShowFocusOnTabs();

export default function App() {
  React.useEffect(() => {
    const ws = new WebSocket(`ws://${window.location.host}`);
  }, []);
  return (
    <Router>
      <Navigation />
      <Switch>
        <Route path="/scoreboard">
          <Scoreboard />
        </Route>
        <Route path="/schedule">
          <Schedule />
        </Route>
        <Route path="/game">
          <Game />
        </Route>
        <Route path="/dashboard">
          <Dashboard />
        </Route>
        <Redirect exact from="*" to="/scoreboard" />
      </Switch>
    </Router>
  );
}
