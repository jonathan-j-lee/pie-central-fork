import * as React from 'react';
import {
  ControlGroup,
  FormGroup,
  Intent,
} from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { MatchSelect } from '../EntitySelects';
import { OutcomeButton } from '../Notification';
import { useAppDispatch, useAppSelector } from '../../hooks';
import { connectMatch } from '../../store/control';
import { MatchPhase } from '../../../types';

interface MatchConnectorProps {
  phase: MatchPhase;
  totalTime: number;
}

export default function MatchConnector(props: MatchConnectorProps) {
  const dispatch = useAppDispatch();
  const currentMatchId = useAppSelector((state) => state.control.matchId);
  const [matchId, setMatchId] = React.useState<number | null>(currentMatchId);
  return (
    <FormGroup
      label="Select a match to play"
      helperText="Connect to robots and initialize the scoreboard."
    >
      <ControlGroup>
        <MatchSelect id={matchId} onSelect={setMatchId} />
        <OutcomeButton
          text="Connect"
          disabled={matchId === null}
          intent={Intent.PRIMARY}
          icon={IconNames.CELL_TOWER}
          onClick={async () => {
            if (matchId) {
              dispatch(connectMatch(matchId, props.phase, props.totalTime));
            }
          }}
          success="Selected match."
          failure="Failed to select match."
        />
      </ControlGroup>
    </FormGroup>
  );
}
