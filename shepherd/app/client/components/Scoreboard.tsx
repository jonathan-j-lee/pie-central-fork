import * as React from 'react';
import { Card, H1, H2, Intent, Spinner } from '@blueprintjs/core';
import { select } from './EntitySelects';
import { useAppSelector } from '../store';
import * as matchUtils from '../store/matches';
import * as teamUtils from '../store/teams';
import {
  AllianceColor,
  GameState,
  MatchPhase,
  TimerState,
  isRunning,
  displayTeam,
  displayTime,
  displayPhase,
} from '../../types';

function Timer(props: TimerState) {
  const timeRemaining = Math.max(props.timeRemaining, 0);
  const fraction =
    !isRunning(props.phase) || props.totalTime === 0
      ? undefined
      : timeRemaining / props.totalTime;
  let intent: Intent | undefined = undefined;
  if (fraction) {
    intent = Intent.SUCCESS;
    if (fraction < 0.1) {
      intent = Intent.DANGER;
    } else if (fraction < 0.2) {
      intent = Intent.WARNING;
    }
  }
  const timerRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const svg = timerRef.current?.getElementsByTagName('svg')[0];
    svg?.setAttribute('viewBox', '0 0 100 100');
    svg?.setAttribute('stroke-width', '3');
  }, [timerRef.current]);
  return (
    <div className="timer" ref={timerRef}>
      <div className="timer-label">
        <H1>{displayPhase(props.phase)}</H1>
        <H1>{displayTime(timeRemaining / 1000)}</H1>
      </div>
      <Spinner size={400} value={fraction} intent={intent} />
    </div>
  );
}

export default function Scoreboard() {
  const controlState = useAppSelector((state) => state.control);
  const matchesState = useAppSelector((state) => state.matches);
  const teamsState = useAppSelector((state) => state.teams);
  const match = select(matchUtils.selectors, matchesState, controlState.matchId);
  const { blue, gold } = GameState.fromEvents(match?.events ?? []);
  const [timeRemaining, setTimeRemaining] = React.useState(
    controlState.timer.timeRemaining
  );

  React.useEffect(() => {
    if (controlState.timer.timeRemaining <= 0) {
      return;
    }
    if (controlState.timer.stage !== 'running') {
      setTimeRemaining(controlState.timer.timeRemaining);
      return;
    }
    let done = false;
    const interval = setInterval(() => {
      const timeElapsed = Date.now() - controlState.clientTimestamp;
      const timeRemaining = controlState.timer.timeRemaining - timeElapsed;
      if (timeRemaining > 0) {
        setTimeRemaining(timeRemaining);
      } else {
        setTimeRemaining(0);
        clearInterval(interval);
        done = true;
      }
    }, 100);
    return () => {
      if (!done) {
        clearInterval(interval);
      }
    };
  }, [controlState, setTimeRemaining]);

  // TODO: look up alliance names
  return (
    <div className="container">
      <Card className="blue alliance">
        <H1>Blue</H1>
        <H2>Score: {blue.score}</H2>
        {blue.teams.map((id, index) => {
          const team = teamUtils.selectors.selectById(teamsState, id);
          return <H2 key={index}>{displayTeam(team)}</H2>;
        })}
      </Card>
      <Timer {...controlState.timer} timeRemaining={timeRemaining} />
      <Card className="gold alliance">
        <H1>Gold</H1>
        <H2>Score: {gold.score}</H2>
        {gold.teams.map((id, index) => {
          const team = teamUtils.selectors.selectById(teamsState, id);
          return <H2 key={index}>{displayTeam(team)}</H2>;
        })}
      </Card>
    </div>
  );
}
