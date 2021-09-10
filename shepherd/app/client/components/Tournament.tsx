import * as React from 'react';
import { EntityState } from '@reduxjs/toolkit';
import { Callout, Colors, Intent } from '@blueprintjs/core';
import { select } from './EntitySelects';
import { AppDispatch, useAppDispatch, useAppSelector } from '../store';
import * as allianceUtils from '../store/alliances';
import { updateWinner } from '../store/bracket';
import { Alliance, Fixture } from '../../types';

import { Container, SVG } from '@svgdotjs/svg.js';

const LIGHT_BLUE = '#bbdef5';
const LIGHT_GOLD = '#fce7b3';

interface LabelOptions {
  width: number;
  height: number;
  horizontalOffset: number;
  verticalOffset: number;
  strokeWidth: number;
  dispatch: AppDispatch;
  edit: boolean;
  alliancesState: EntityState<Alliance>;
}

const sign = (x: number) => x < 0 ? -1 : (x > 0 ? 1 : 0);

interface Node {
  fixture: Fixture | null;
  x: number;
  y: number;
}

function getBracketPath(current: Node, prev: Node, options: LabelOptions) {
  const xDelta = sign(options.horizontalOffset) * options.width / 2;
  const xNear = current.x - xDelta;
  const xFar = current.x + xDelta;
  const xMid = (prev.x + xNear) / 2;
  const yMid = (prev.y + current.y) / 2;
  const xControl = (prev.x + xMid) / 2;
  return {
    path: `M ${prev.x} ${prev.y} Q ${xControl} ${prev.y} ${xMid} ${yMid} T ${xNear} ${current.y}`,
    xNear,
    xFar,
    xMid,
    yMid,
  };
}

function drawBracket(
  draw: Container,
  current: Node,
  prev: Node,
  branch: 'blue' | 'gold',
  options: LabelOptions,
) {
  if (!current.fixture || !prev.fixture) {
    return;
  }
  const winner = current.fixture.winner;

  const alliance = select(allianceUtils.selectors, options.alliancesState, current.fixture.winner);
  const labelBox = draw
    .rect(options.width, options.height)
    .center(current.x, current.y)
    .fill(winner === null ? Colors.LIGHT_GRAY3 : Colors.GREEN5);

  if (current.fixture.blue && current.fixture.gold) {
    // TODO: use gray when there is no winner
    // TODO: shade current match
    // labelBox
    //   .on('mouseover', () => labelBox.fill(Colors.GREEN4))
    //   .on('mouseout', () => labelBox.fill(Colors.GREEN5))
    //   .on('click', () => {
    //   });
  }
  draw
    .text(alliance?.name ?? '?')
    .center(current.x, current.y);

  const { xFar, path: pathSpec } = getBracketPath(current, prev, options);
  const inactiveColor = branch === 'blue' ? LIGHT_BLUE : LIGHT_GOLD;
  const activeColor = branch === 'blue' ? Colors.BLUE3 : Colors.GOLD3;
  let color: string;
  if (winner === null) {
    color = Colors.LIGHT_GRAY4;
  } else {
    color = prev.fixture.winner === current.fixture.winner ? activeColor : inactiveColor;
  }
  const path = draw
    .path(pathSpec)
    .fill('none')
    .stroke({ width: options.strokeWidth, color });

  // TODO: center the entire thing

  if (options.edit && winner !== null) {
    path
      .on('mouseover', () => path.stroke({ width: options.strokeWidth, color: activeColor }))
      .on('mouseout', () => path.stroke({ width: options.strokeWidth, color }))
      .on('click', () => {
        if (prev.fixture) {
          if (prev.fixture.winner === winner) {
            options.dispatch(updateWinner({ id: prev.fixture.id, winner: null }));
          } else {
            options.dispatch(updateWinner({ id: prev.fixture.id, winner }));
          }
        }
      });
  }

  const x = current.x + options.horizontalOffset;
  const { verticalOffset } = options;
  const nextPrev = { fixture: current.fixture, x: xFar, y: current.y };
  options = { ...options, verticalOffset: 0.5 * verticalOffset };
  const blue = { fixture: current.fixture.blue, x, y: current.y - verticalOffset };
  const gold = { fixture: current.fixture.gold, x, y: current.y + verticalOffset };
  drawBracket(draw, blue, nextPrev, 'blue', options);
  drawBracket(draw, gold, nextPrev, 'gold', options);
}

export default function Tournament(props: { edit: boolean }) {
  const dispatch = useAppDispatch();
  const alliancesState = useAppSelector((state) => state.alliances);
  const bracket = useAppSelector((state) => state.bracket);
  const visRef = React.useRef<SVGSVGElement | null>(null);
  React.useEffect(() => {
    const svg = visRef.current;
    if (!svg || !bracket) {
      return;
    }
    const draw = SVG(svg);
    draw.clear();
    draw.viewbox(-200, -200, 400, 400);
    const width = 120;
    const height = 30;
    const options = {
      width: 120,
      height: 30,
      verticalOffset: 80,
      strokeWidth: 6,
      dispatch,
      edit: props.edit,
      alliancesState,
    };
    drawBracket(
      draw,
      { fixture: bracket.blue, x: -80, y: -60 },
      { fixture: bracket, x: 0, y: -height / 2 },
      'blue',
      { ...options, horizontalOffset: -150 },
    );
    drawBracket(
      draw,
      { fixture: bracket.gold, x: 80, y: 60 },
      { fixture: bracket, x: 0, y: height / 2 },
      'gold',
      { ...options, horizontalOffset: 150 },
    );
    draw
      .rect(width, height)
      .center(0, 0)
      .fill(bracket.winner === null ? Colors.LIGHT_GRAY3 : Colors.GREEN5);
    draw.text(select(allianceUtils.selectors, alliancesState, bracket.winner)?.name ?? '?').center(0, 0);
  }, [props.edit, dispatch, visRef, alliancesState, bracket]);
  return bracket && (
    <>
      <svg width="100%" height="400px" ref={visRef} />
      {props.edit && (
        <Callout className="spacer" intent={Intent.PRIMARY}>
          You can edit which alliances advance in each round by clicking the blue and gold paths.
        </Callout>
      )}
    </>
  );
}
