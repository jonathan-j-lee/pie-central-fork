import { useAppSelector, useRobots } from '../../hooks';
import MatchProjection from './MatchProjection';
import ScoreAdjustment from './ScoreAdjustment';
import TeamAdder from './TeamAdder';
import TeamConnectionTable from './TeamConnectionTable';
import TimerControl from './TimerControl';
import TimerExtender from './TimerExtender';
import { Card, NonIdealState } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import * as React from 'react';

export default function Dashboard() {
  const matchId = useAppSelector((state) => state.control.matchId);
  const [robots, setSelection] = useRobots();
  return (
    <>
      <Card>
        <div className="control-bar">
          <TimerControl robots={robots} />
          <TimerExtender robots={robots} />
        </div>
        {matchId !== null ? (
          <TeamConnectionTable robots={robots} setSelection={setSelection} />
        ) : (
          <NonIdealState
            className="team-connection"
            icon={IconNames.OFFLINE}
            title="No match selected"
            description="Select a match to play."
          />
        )}
        <div className="control-bar">
          <TeamAdder />
          <ScoreAdjustment />
        </div>
      </Card>
      <div className="container spacer">
        <div className="column">
          <MatchProjection />
        </div>
        <div className="column"></div>
      </div>
    </>
  );
}
