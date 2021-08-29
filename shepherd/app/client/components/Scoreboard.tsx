import * as React from 'react';
import { Card, H1, H2, Intent, Spinner } from '@blueprintjs/core';
import { displayTime } from './Util';

enum Mode {
  AUTO = 'auto',
  TELEOP = 'teleop',
  IDLE = 'idle',
  ESTOP = 'estop',
}

const displayMode = (mode: Mode) => {
  switch (mode) {
    case Mode.AUTO:
      return 'Autonomous';
    case Mode.TELEOP:
      return 'Tele-op';
    default:
      return '(Unknown phase)';
  }
};

function Timer(props: { mode: Mode; timeRemaining: number; totalTime: number }) {
  const fraction = props.timeRemaining / props.totalTime;
  let intent: Intent = Intent.SUCCESS;
  if (fraction < 0.1) {
    intent = Intent.DANGER;
  } else if (fraction < 0.2) {
    intent = Intent.WARNING;
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
        <H1>{displayMode(props.mode)}</H1>
        <H1>{displayTime(props.timeRemaining)}</H1>
      </div>
      <Spinner size={400} value={fraction} intent={intent} />
    </div>
  );
}

export default function Scoreboard() {
  const blue = {
    score: 47,
    teams: [
      { name: 'Albany', num: 1 },
      { name: 'Hayward', num: 2 },
    ],
  };
  const gold = {
    score: 102,
    teams: [
      { name: 'Arroyo', num: 3 },
      { name: 'ACLC', num: 4 },
    ],
  };
  return (
    <div className="container">
      <Card className="blue alliance">
        <H1>Blue</H1>
        <H2>Score: {blue.score}</H2>
        {blue.teams.map(({ name, num }, index) => (
          <H2 key={index}>
            {name} (#{num})
          </H2>
        ))}
      </Card>
      <Timer mode={Mode.TELEOP} timeRemaining={16} totalTime={90} />
      <Card className="gold alliance">
        <H1>Gold</H1>
        <H2>Score: {gold.score}</H2>
        {gold.teams.map(({ name, num }, index) => (
          <H2 key={index}>
            {name} (#{num})
          </H2>
        ))}
      </Card>
    </div>
  );
}
