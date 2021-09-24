import * as React from 'react';
import { H1, Intent, Spinner } from '@blueprintjs/core';
import { useTimer } from '../hooks';
import { displayTime, displayPhase, isRunning } from '../../types';

export default function Timer() {
  const timer = useTimer();
  const running = isRunning(timer.phase) && timer.totalTime > 0;
  const timeRemaining = running ? Math.max(timer.timeRemaining, 0) : -1;
  const fraction = running ? timeRemaining / timer.totalTime : undefined;
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
        <H1>{displayPhase(timer.phase)}</H1>
        <H1>{displayTime(timeRemaining / 1000)}</H1>
      </div>
      <Spinner size={400} value={fraction} intent={intent} />
    </div>
  );
}
