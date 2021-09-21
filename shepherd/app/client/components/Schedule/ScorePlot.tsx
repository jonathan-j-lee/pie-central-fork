import * as React from 'react';
import { Card, Colors } from '@blueprintjs/core';
import Chart from 'chart.js/auto';
import { Scatter } from 'react-chartjs-2';
import { useAppSelector } from '../../hooks';
import {
  AllianceColor,
  GameState,
  Match,
  MatchInterval,
  MatchPhase,
  displayTime,
  isRunning,
} from '../../../types';

const AUTO_COLOR = 'rgba(113, 87, 217, 0.2)';
const TELEOP_COLOR = 'rgba(242, 157, 73, 0.2)';

type Point = { x: number, y: number };

function getScoreTimeSeries(match: Match) {
  const scores = {
    [AllianceColor.BLUE]: [{ x: 0, y: 0 }] as Point[],
    [AllianceColor.GOLD]: [{ x: 0, y: 0 }] as Point[],
  };
  const game = GameState.fromEvents([]);
  const earliestTimestamp = Math.min(
    ...match.events.map((event) => event.timestamp).filter((timestamp) => timestamp)
  );
  const toOffset = (timestamp: number) => (timestamp - earliestTimestamp) / 1000;
  let min = Infinity;
  let max = -Infinity;
  for (const event of match.events) {
    game.apply(event);
    if (event.timestamp && event.alliance !== AllianceColor.NONE) {
      const seq = scores[event.alliance];
      const score = game[event.alliance].score;
      min = Math.min(min, score);
      max = Math.max(max, score);
      if (seq.length === 0 || score !== seq[seq.length - 1].y) {
        seq.push({ x: toOffset(event.timestamp), y: score });
      }
    }
  }
  const intervals: MatchInterval[] = game
    .transitions
    .filter((transition) => isRunning(transition.phase))
    .map(({ phase, start, stop }) => ({
      phase,
      start: toOffset(start),
      stop: toOffset(stop),
    }));
  const margin = 0.2 * (max - min);
  return { scores, intervals, min: min - 0.5*margin, max: max + 0.5*margin };
}

export default function ScorePlot(props: { match: Match }) {
  const darkTheme = useAppSelector((state) => state.user.darkTheme);
  const color = darkTheme ? Colors.GRAY4 : Colors.GRAY2;
  const blueColor = darkTheme ? Colors.BLUE3 : Colors.BLUE4;
  const goldColor = darkTheme ? Colors.GOLD3 : Colors.GOLD4;
  const { scores, intervals, min, max } = getScoreTimeSeries(props.match);
  return (
    <Card className="score-plot">
      <Scatter
        data={{
          datasets: [
            {
              type: 'line',
              label: 'Blue Alliance',
              data: scores.blue,
              showLine: true,
              borderColor: blueColor,
              backgroundColor: blueColor,
            },
            {
              type: 'line',
              label: 'Gold Alliance',
              data: scores.gold,
              showLine: true,
              borderColor: goldColor,
              backgroundColor: goldColor,
            },
            {
              label: 'Autonomous Period',
              backgroundColor: AUTO_COLOR,
              borderWidth: 0,
            },
            {
              label: 'Teleop Period',
              backgroundColor: TELEOP_COLOR,
              borderWidth: 0,
            },
          ],
        }}
        options={{
          aspectRatio: 1.5,
          color,
          scales: {
            x: {
              min: 0,
              title: { display: true, text: 'Time Since Match Start', color },
              ticks: {
                callback: (duration: number) => displayTime(duration, 0),
                color,
              },
            },
            y: {
              min,
              max,
              title: { display: true, text: 'Cumulative Points', color },
              ticks: { color },
            },
          },
          animation: { duration: 0 },
          plugins: {
            annotation: {
              drawTime: 'beforeDatasetsDraw',
              annotations: intervals.map((interval) => ({
                type: 'box',
                xMin: interval.start,
                xMax: interval.stop,
                yMin: min - 1,
                yMax: max + 1,
                backgroundColor:
                  interval.phase === MatchPhase.AUTO ? AUTO_COLOR : TELEOP_COLOR,
                borderWidth: 0,
              }))
            },
          },
        }}
      />
    </Card>
  );
}
