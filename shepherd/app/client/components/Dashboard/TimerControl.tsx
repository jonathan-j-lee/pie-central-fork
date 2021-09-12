import * as React from 'react';
import {
  ControlGroup,
  FormGroup,
  HTMLSelect,
  Intent,
  NumericInput,
} from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import {
  MatchEventType,
  MatchPhase,
  displayPhase,
} from '../../../types';
import { AlertButton } from '../Util';
import { useAppDispatch } from '../../hooks';
import { changeMode, Robot } from '../../store/control';
import MatchConnector from './MatchConnector';

export default function TimerControl(props: { robots: Robot[] }) {
  const dispatch = useAppDispatch();
  const [phase, setPhase] = React.useState(MatchPhase.AUTO);
  // TODO: infer match defaults
  const [totalTime, setTotalTime] = React.useState(
    phase === MatchPhase.AUTO ? 30 : 180
  );
  const warnings = props.robots.every((robot) => robot.selected)
    ? []
    : [
        'Are you sure you want to change the running state of only some robots? ' +
          'Robots are normally started or stopped all together.',
      ];
  const disabled = props.robots.length === 0;
  return (
    <>
      <MatchConnector phase={phase} totalTime={totalTime} />
      <FormGroup
        label="Start or stop robots"
        helperText={
          'Activate the robots selected in the table below. ' +
          'The robots will shut off automatically after the number of seconds given.'
        }
      >
        <ControlGroup>
          <HTMLSelect
            value={phase}
            onChange={({ currentTarget: { value } }) => setPhase(value as MatchPhase)}
            disabled={disabled}
          >
            <option value={MatchPhase.AUTO}>{displayPhase(MatchPhase.AUTO)}</option>
            <option value={MatchPhase.TELEOP}>{displayPhase(MatchPhase.TELEOP)}</option>
          </HTMLSelect>
          <NumericInput
            allowNumericCharactersOnly
            clampValueOnBlur
            placeholder="Number of seconds"
            disabled={disabled}
            min={0}
            defaultValue={totalTime}
            onValueChange={(totalTime) => setTotalTime(totalTime)}
          />
          <AlertButton
            getWarnings={() => warnings}
            disabled={disabled}
            text="Start"
            intent={Intent.PRIMARY}
            icon={IconNames.PLAY}
            onClick={() =>
              dispatch(
                changeMode({
                  mode: phase === MatchPhase.AUTO
                    ? MatchEventType.AUTO
                    : MatchEventType.TELEOP,
                  totalTime,
                  robots: props.robots,
                })
              )
            }
          />
          <AlertButton
            getWarnings={() => [
              ...warnings,
              'Are you sure you want to preemptively stop the match? ' +
                'Shepherd normally stops robots automatically.',
            ]}
            disabled={disabled}
            text="Stop"
            intent={Intent.WARNING}
            icon={IconNames.STOP}
            onClick={() =>
              dispatch(changeMode({ mode: MatchEventType.IDLE, robots: props.robots }))
            }
          />
          <AlertButton
            getWarnings={() => [
              ...warnings,
              'Are you sure you want to e-stop one or more robots? ' +
                'E-stopped robots cannot be restarted.',
            ]}
            disabled={disabled}
            text="E-Stop"
            intent={Intent.DANGER}
            icon={IconNames.FLAME}
            onClick={() =>
              dispatch(changeMode({ mode: MatchEventType.ESTOP, robots: props.robots }))
            }
          />
        </ControlGroup>
      </FormGroup>
    </>
  );
}
