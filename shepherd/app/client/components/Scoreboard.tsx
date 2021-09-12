import * as React from 'react';
import { Card, H1, H2 } from '@blueprintjs/core';
import Timer from './Timer';
import { useAppSelector, useCurrentMatch } from '../hooks';
import { selectors as teamSelectors } from '../store/teams';
import { GameState, displayTeam } from '../../types';

export default function Scoreboard() {
  const teams = useAppSelector((state) => state.teams);
  const match = useCurrentMatch();
  const { blue, gold } = GameState.fromEvents(match?.events ?? []);
  // TODO: look up alliance names
  return (
    <div className="container">
      <Card className="blue alliance">
        <H1>Blue</H1>
        <H2>Score: {blue.score}</H2>
        {blue.teams.map((id, index) => {
          const team = teamSelectors.selectById(teams, id);
          return <H2 key={index}>{displayTeam(team)}</H2>;
        })}
      </Card>
      <Timer />
      <Card className="gold alliance">
        <H1>Gold</H1>
        <H2>Score: {gold.score}</H2>
        {gold.teams.map((id, index) => {
          const team = teamSelectors.selectById(teams, id);
          return <H2 key={index}>{displayTeam(team)}</H2>;
        })}
      </Card>
    </div>
  );
}
