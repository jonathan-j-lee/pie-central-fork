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
  GameState,
  MatchEventType,
  MatchPhase,
  displayPhase,
  getDefaultDuration,
} from '../../../types';
import { AlertButton } from '../Notification';
import { useAppDispatch, useCurrentMatch } from '../../hooks';
import { changeMode, Robot } from '../../store/control';
import MatchConnector from './MatchConnector';

export default function TimerControl(props: { robots: Robot[] }) {
  const dispatch = useAppDispatch();
  const [phase, setPhase] = React.useState(MatchPhase.AUTO);
  const [totalTime, setTotalTime] = React.useState(getDefaultDuration(phase));
  const match = useCurrentMatch();
  const game = GameState.fromEvents(match?.events ?? []);
  const autoComplete = game.transitions.some(({ phase }) => phase === MatchPhase.AUTO);
  React.useEffect(() => {
    const targetPhase = autoComplete ? MatchPhase.TELEOP : MatchPhase.AUTO;
    if (targetPhase !== phase) {
      setPhase(targetPhase);
      setTotalTime(getDefaultDuration(targetPhase));
    }
  }, [autoComplete, setPhase, setTotalTime]);
  const warnings = props.robots.every((robot) => robot.selected)
    ? []
    : [
        'Are you sure you want to change the running state of only some robots? ' +
          'Robots are normally started or stopped all together.',
      ];
  const disabled = props.robots.filter((robot) => robot.selected).length === 0;
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
            fill
            placeholder="Number of seconds"
            disabled={disabled}
            min={0}
            value={totalTime}
            onValueChange={(totalTime) => setTotalTime(totalTime)}
          />
          <AlertButton
            getWarnings={() => warnings}
            disabled={disabled}
            text="Start"
            intent={Intent.PRIMARY}
            icon={IconNames.PLAY}
            onClick={async () => {
              await dispatch(
                changeMode({
                  mode: phase === MatchPhase.AUTO
                    ? MatchEventType.AUTO
                    : MatchEventType.TELEOP,
                  totalTime,
                  robots: props.robots,
                })
              ).unwrap();
            }}
            success="Started robots."
            failure="Failed to start robots."
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
            onClick={async () => {
              await dispatch(
                changeMode({ mode: MatchEventType.IDLE, robots: props.robots })
              ).unwrap();
            }}
            success="Stopped robots."
            failure="Failed to stop robots."
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
            onClick={async () => {
              await dispatch(
                changeMode({ mode: MatchEventType.ESTOP, robots: props.robots })
              ).unwrap();
            }}
            success="E-stopped robots."
            failure="Failed to e-stop robots."
          />
        </ControlGroup>
      </FormGroup>
    </>
  );
}
