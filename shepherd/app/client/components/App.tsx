import * as React from 'react';
import { BrowserRouter as Router, Switch, Route, Redirect } from 'react-router-dom';
import { FocusStyleManager } from '@blueprintjs/core';

import { useAppDispatch } from '../store';
import controlSlice, * as controlUtils from '../store/control';
import * as allianceUtils from '../store/alliances';
import matchSlice, * as matchUtils from '../store/matches';
import * as teamUtils from '../store/teams';

import Navigation from './Navigation';
import Scoreboard from './Scoreboard';
import Schedule from './Schedule';
import Leaderboard from './Leaderboard';
import Game from './Game';
import Dashboard from './Dashboard';

FocusStyleManager.onlyShowFocusOnTabs();

export default function App() {
  const dispatch = useAppDispatch();
  React.useEffect(() => {
    dispatch(controlUtils.init());
    dispatch(allianceUtils.fetch());
    dispatch(teamUtils.fetch());
    dispatch(matchUtils.fetch());
  }, [dispatch]);
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
          <Route path="/game">
            <Game />
          </Route>
          <Route path="/dashboard">
            <Dashboard />
          </Route>
          <Redirect exact from="*" to="/scoreboard" />
        </Switch>
      </main>
    </Router>
  );
}
