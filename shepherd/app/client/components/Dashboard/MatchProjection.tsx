import * as React from 'react';
import { Card, Colors } from '@blueprintjs/core';
import * as _ from 'lodash';
import Chart from 'chart.js/auto';
import { Scatter, defaults } from 'react-chartjs-2';
import { useAppSelector, useMatches } from '../../hooks';
import { displayTime } from '../../../types';

defaults.font.family = 'monospace';

function cumulativeSum(xs: number[], initial = 0) {
  const seq = [initial];
  for (const x of xs) {
    seq.push(seq[seq.length - 1] + x);
  }
  return seq;
}

function useMatchProjection() {
  const matches = useMatches();
  const durations = matches
    .filter((match) => match.earliestTimestamp < Infinity && match.latestTimestamp > 0)
    .map((match) => (match.latestTimestamp - match.earliestTimestamp) / 1000);
  const history = cumulativeSum(durations);
  const meanMatchDuration = history[history.length - 1] / durations.length;
  const projected = cumulativeSum(
    Array(matches.length - durations.length).fill(meanMatchDuration),
    history[history.length - 1],
  );
  const matchesRemaining = projected.length - 1;
  return {
    matchesRemaining,
    stop: isNaN(meanMatchDuration)
      ? null
      : new Date(Date.now() + 1000 * meanMatchDuration * matchesRemaining),
    history: history.map((y, index) => ({ x: index, y })),
    projected: projected.map((y, index) => ({ x: history.length + index - 1, y })),
    durations: durations.map((y, index) => ({ x: index + 1, y })),
  };
}

export default function MatchProjection() {
  const darkTheme = useAppSelector((state) => state.user.darkTheme);
  const color = darkTheme ? Colors.GRAY4 : Colors.GRAY2;
  const ref = React.useRef<Chart | null>(null);
  const chart = ref.current;
  const projection = useMatchProjection();
  React.useEffect(() => {
    if (chart) {
      const [history, projected, durations] = chart.data.datasets;
      history.data = projection?.history ?? [];
      projected.data = projection?.projected ?? [];
      durations.data = projection?.durations ?? [];
      chart.update();
    }
  }, [chart, projection]);
  return (
    <Card>
      {projection.stop && (
        <p>
          With no downtime, we estimate you will finish
          the {projection.matchesRemaining} remaining scheduled matches
          by {projection.stop.toLocaleTimeString()}.
        </p>
      )}
      <Scatter
        ref={ref}
        data={{
          datasets: [
            {
              type: 'line',
              label: 'Cumulative Time',
              data: [],
              showLine: true,
              color,
              borderColor: color,
            },
            {
              type: 'line',
              label: 'Projected Cumulative Time',
              data: [],
              showLine: true,
              borderDash: [10, 5],
              color,
              borderColor: color,
            },
            {
              type: 'bar',
              label: 'Match Duration',
              data: [],
              backgroundColor: 'rgba(43, 149, 214, 0.4)',
            },
          ],
        }}
        options={{
          aspectRatio: 1.5,
          color,
          scales: {
            x: {
              title: { display: true, text: 'Matches Played', color },
              ticks: { stepSize: 1, color },
            },
            y: {
              min: 0,
              ticks: { callback: (duration: number) => displayTime(duration), color },
            },
          },
          animation: { duration: 0 },
        }}
      />
    </Card>
  );
}
