import darkStyle from '../../../node_modules/highlight.js/styles/atom-one-dark.css';
import lightStyle from '../../../node_modules/highlight.js/styles/atom-one-light.css';
import { useAppSelector } from '../hooks';
import Dashboard from './Dashboard';
import Games from './Games';
import Leaderboard from './Leaderboard';
import Log from './Log';
import Navigation from './Navigation';
import Schedule from './Schedule';
import Scoreboard from './Scoreboard';
import { FocusStyleManager } from '@blueprintjs/core';
import annotationPlugin from 'chartjs-plugin-annotation';
import * as React from 'react';
import { Chart, defaults } from 'react-chartjs-2';
import { BrowserRouter as Router, Switch, Route, Redirect } from 'react-router-dom';

FocusStyleManager.onlyShowFocusOnTabs();
Chart.register(annotationPlugin);
defaults.font.size = 14;
defaults.font.family = 'monospace';

function useHighlightStylesheet() {
  const darkTheme = useAppSelector((state) => state.user.darkTheme);
  React.useEffect(() => {
    if (darkTheme) {
      lightStyle.unuse();
      darkStyle.use();
    } else {
      lightStyle.use();
      darkStyle.unuse();
    }
  }, [darkTheme]);
}

export default function App() {
  useHighlightStylesheet();
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
          <Route path="/log">
            <Log />
          </Route>
          <Redirect exact from="*" to="/scoreboard" />
        </Switch>
      </main>
    </Router>
  );
}
