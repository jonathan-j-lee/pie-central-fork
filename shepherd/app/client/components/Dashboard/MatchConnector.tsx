import * as React from 'react';
import {
  Button,
  ControlGroup,
  FormGroup,
  Intent,
} from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { MatchSelect } from '../EntitySelects';
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
        <MatchSelect id={matchId} onSelect={(match) => setMatchId(match.id)} />
        <Button
          text="Connect"
          disabled={matchId === null}
          intent={Intent.PRIMARY}
          icon={IconNames.CELL_TOWER}
          onClick={() =>
            matchId && dispatch(connectMatch(matchId, props.phase, props.totalTime))
          }
        />
      </ControlGroup>
    </FormGroup>
  );
}
