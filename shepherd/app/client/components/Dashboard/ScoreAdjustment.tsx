import * as React from 'react';
import {
  Button,
  ControlGroup,
  FormGroup,
  Intent,
  NumericInput,
} from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { AllianceColorSelect } from '../EntitySelects';
import { useAppDispatch, useAppSelector } from '../../hooks';
import { adjustScore } from '../../store/control';
import { AllianceColor, MatchEventType } from '../../../types';

export default function ScoreAdjustment() {
  const dispatch = useAppDispatch();
  const matchId = useAppSelector((state) => state.control.matchId);
  const [alliance, setAlliance] = React.useState(AllianceColor.NONE);
  const [points, setPoints] = React.useState(0);
  return (
    <FormGroup
      label="Adjust scores"
      helperText="Add or subtract points from an alliance's score."
    >
      <ControlGroup>
        <AllianceColorSelect
          disabled={matchId === null}
          value={alliance}
          setValue={setAlliance}
        />
        <NumericInput
          allowNumericCharactersOnly
          disabled={matchId === null}
          placeholder="Number of points"
          defaultValue={points}
          onValueChange={(value) => setPoints(value)}
        />
        <Button
          disabled={matchId === null || points === 0}
          text="Add score"
          icon={IconNames.ADD}
          intent={Intent.SUCCESS}
          onClick={() => dispatch(adjustScore({ alliance, points }))}
        />
      </ControlGroup>
    </FormGroup>
  );
}
