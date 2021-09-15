import * as React from 'react';
import {
  Button,
  ControlGroup,
  FormGroup,
  Intent,
  NumericInput,
} from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useAppDispatch, useAppSelector } from '../../hooks';
import { extendMatch, Robot } from '../../store/control';
import { MatchEventType } from '../../../types';

export default function TimerExtender(props: { robots: Robot[] }) {
  const dispatch = useAppDispatch();
  const matchId = useAppSelector((state) => state.control.matchId);
  const [extension, setExtension] = React.useState(0);
  const disabled = props.robots.length === 0;
  return (
    <FormGroup
      label="Extend the match"
      helperText="Manually delay the shutoff of the selected robots."
    >
      <ControlGroup>
        <NumericInput
          allowNumericCharactersOnly
          clampValueOnBlur
          fill
          disabled={disabled}
          placeholder="Number of seconds"
          min={0}
          defaultValue={extension}
          onValueChange={(extension) => setExtension(extension)}
        />
        <Button
          disabled={disabled}
          text="Add time"
          intent={Intent.SUCCESS}
          icon={IconNames.TIME}
          onClick={() => dispatch(extendMatch({ extension, robots: props.robots }))}
        />
      </ControlGroup>
    </FormGroup>
  );
}
