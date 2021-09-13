import * as React from 'react';
import { NonIdealState } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';

import ScoreAdjustment from './ScoreAdjustment';
import TeamAdder from './TeamAdder';
import TeamConnectionTable from './TeamConnectionTable';
import TimerControl from './TimerControl';
import TimerExtender from './TimerExtender';
import MatchProjection from './MatchProjection';
import { useAppSelector, useRobots } from '../../hooks';

export default function Dashboard() {
  const matchId = useAppSelector((state) => state.control.matchId);
  const [robots, setSelection] = useRobots();
  return (
    <>
      <div className="control-bar spacer">
        <TimerControl robots={robots} />
        <TimerExtender robots={robots} />
      </div>
      {matchId !== null ? (
        <TeamConnectionTable robots={robots} setSelection={setSelection} />
      ) : (
        <NonIdealState
          className="no-match"
          icon={IconNames.OFFLINE}
          title="No match selected"
          description="Select a match to play."
        />
      )}
      <div className="control-bar spacer">
        <TeamAdder />
        <ScoreAdjustment />
      </div>
      <div className="container spacer">
        <div className="column">
          <MatchProjection />
        </div>
        <div className="column">
        </div>
      </div>
    </>
  );
}
