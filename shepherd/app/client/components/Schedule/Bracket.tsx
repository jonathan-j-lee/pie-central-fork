import * as React from 'react';
import { Callout, Colors, Intent } from '@blueprintjs/core';
import { Container, SVG } from '@svgdotjs/svg.js';
import {
  useAppDispatch,
  useAppSelector,
  useBracket,
  useCurrentMatch,
} from '../../hooks';
import type { AppDispatch } from '../../store';
import { updateWinner } from '../../store/bracket';
import { Alliance, Fixture } from '../../../types';

interface BracketColors {
  text: string;
  inactive: string;
  activeLabel: string;
  activeLabelStripe: string;
  activePath: {
    blue: string;
    gold: string;
  };
  selectedPath: {
    blue: string;
    gold: string;
  };
}

const LIGHT_THEME: BracketColors = {
  text: Colors.BLACK,
  inactive: Colors.LIGHT_GRAY3,
  activeLabel: Colors.GREEN5,
  activeLabelStripe: Colors.GREEN4,
  activePath: {
    blue: '#bbdef5',
    gold: '#fce7b3',
  },
  selectedPath: {
    blue: Colors.BLUE4,
    gold: Colors.GOLD4,
  },
};

const DARK_THEME: BracketColors = {
  text: Colors.WHITE,
  inactive: '#31424f',
  activeLabel: Colors.GREEN3,
  activeLabelStripe: Colors.GREEN2,
  activePath: {
    blue: 'rgba(16, 35, 79, 0.3)',
    gold: 'rgba(128, 116, 13, 0.3)',
  },
  selectedPath: {
    blue: Colors.BLUE3,
    gold: Colors.GOLD3,
  },
};

interface BracketRenderOptions {
  width: number;
  height: number;
  horizontalOffset: number;
  verticalOffset: number;
  strokeWidth: number;
  stripeWidth: number;
  dispatch: AppDispatch;
  edit: boolean;
  colors: BracketColors;
  current: number | null;
}

const SIZE_OPTIONS = {
  width: 120,
  height: 30,
  verticalOffset: 80,
  strokeWidth: 6,
  horizontalOffset: 0,
  stripeWidth: 13,
};

interface BracketNode {
  fixture: Fixture | null;
  x: number;
  y: number;
}

const sign = (x: number) => x < 0 ? -1 : (x > 0 ? 1 : 0);

function getBracketPath(
  current: BracketNode,
  prev: BracketNode,
  options: BracketRenderOptions,
) {
  const xDelta = sign(options.horizontalOffset) * options.width / 2;
  const xNear = current.x - xDelta;
  const xFar = current.x + xDelta;
  const xMid = (prev.x + xNear) / 2;
  const yMid = (prev.y + current.y) / 2;
  const xControl = (prev.x + xMid) / 2;
  const path = `M ${prev.x} ${prev.y} Q ${xControl} ${prev.y} ${xMid} ${yMid} T ${xNear} ${current.y}`;
  return { path, xNear, xFar, xMid, yMid };
}

function drawNextRound(
  draw: Container,
  current: BracketNode,
  xFar: number,
  options: BracketRenderOptions,
) {
  if (current.fixture) {
    const x = current.x + options.horizontalOffset;
    const { verticalOffset } = options;
    const nextPrev = { fixture: current.fixture, x: xFar, y: current.y };
    options = { ...options, verticalOffset: 0.5 * verticalOffset };
    const blue = { fixture: current.fixture.blue, x, y: current.y - verticalOffset };
    const gold = { fixture: current.fixture.gold, x, y: current.y + verticalOffset };
    drawBracket(draw, blue, nextPrev, 'blue', options);
    drawBracket(draw, gold, nextPrev, 'gold', options);
  }
}

function drawNode(draw: Container, current: BracketNode, options: BracketRenderOptions) {
  const winner = current.fixture?.winner;
  const label = draw
    .rect(options.width, options.height)
    .center(current.x, current.y)
  if (options.current === current.fixture?.id) {
    const pattern = draw
      .pattern(2 * options.stripeWidth, options.height, (add) => {
        add
          .rect(options.stripeWidth, options.height)
          .fill(options.colors.activeLabel);
        add
          .rect(options.stripeWidth, options.height)
          .move(options.stripeWidth, 0)
          .fill(options.colors.activeLabelStripe);
      })
      .attr({ patternTransform: 'rotate(45 0 0)' });
    label.fill(pattern);
  } else {
    label.fill(winner ? options.colors.activeLabel : options.colors.inactive);
  }
  draw
    .fill(options.colors.text)
    .text(current.fixture?.winningAlliance?.name ?? '?')
    .center(current.x, current.y);
}

function drawPath(
  draw: Container,
  current: Fixture,
  prev: Fixture,
  branch: 'blue' | 'gold',
  pathSpec: string,
  options: BracketRenderOptions,
) {
  const winner = current.winner;
  const activeColor = options.colors.activePath[branch];
  const selectedColor = options.colors.selectedPath[branch];
  let color: string;
  if (winner) {
    color = prev.winner === current.winner ? selectedColor : activeColor;
  } else {
    color = options.colors.inactive;
  }
  const path = draw
    .path(pathSpec)
    .fill('none')
    .stroke({ width: options.strokeWidth, color });
  if (options.edit && winner) {
    path
      .on('mouseover', () => path.stroke({ width: options.strokeWidth, color: selectedColor }))
      .on('mouseout', () => path.stroke({ width: options.strokeWidth, color }))
      .on('click', () => {
        if (prev) {
          if (prev.winner === winner) {
            options.dispatch(updateWinner({ id: prev.id, winner: null }));
          } else {
            options.dispatch(updateWinner({ id: prev.id, winner }));
          }
        }
      });
  }
}

function drawBracket(
  draw: Container,
  current: BracketNode,
  prev: BracketNode,
  branch: 'blue' | 'gold',
  options: BracketRenderOptions,
) {
  if (current.fixture && prev.fixture) {
    const { xFar, path } = getBracketPath(current, prev, options);
    drawNode(draw, current, options);
    drawPath(draw, current.fixture, prev.fixture, branch, path, options);
    drawNextRound(draw, current, xFar, options);
  }
}

export default function Bracket(props: { edit: boolean }) {
  const dispatch = useAppDispatch();
  const match = useCurrentMatch();
  const [bracket] = useBracket();
  const darkTheme = useAppSelector((state) => state.user.darkTheme);
  const diagramRef = React.useRef<SVGSVGElement | null>(null);
  React.useEffect(() => {
    if (!diagramRef.current || !bracket) {
      return;
    }
    const draw = SVG(diagramRef.current);
    draw.clear();
    draw.viewbox(-200, -200, 400, 400);
    const options = {
      ...SIZE_OPTIONS,
      dispatch,
      edit: props.edit,
      colors: darkTheme ? DARK_THEME : LIGHT_THEME,
      current: match?.fixture ?? null,
    };
    draw
      .text('Champion')
      .center(80, -60);
    draw
      .polyline('120,-45 40,-45 20,-15')
      .fill('none')
      .stroke({ width: 2, color: options.colors.text, dasharray: '10 5' });
    drawBracket(
      draw,
      { fixture: bracket.blue, x: -80, y: -60 },
      { fixture: bracket, x: 0, y: -options.height / 2 },
      'blue',
      { ...options, horizontalOffset: -150 },
    );
    drawBracket(
      draw,
      { fixture: bracket.gold, x: 80, y: 60 },
      { fixture: bracket, x: 0, y: options.height / 2 },
      'gold',
      { ...options, horizontalOffset: 150 },
    );
    drawNode(draw, { fixture: bracket, x: 0, y: 0 }, options);
  }, [props.edit, darkTheme, dispatch, diagramRef, bracket]);
  return bracket && (
    <>
      <svg width="100%" height="400px" ref={diagramRef} />
      {props.edit && (
        <Callout className="spacer" intent={Intent.PRIMARY}>
          You can edit which alliances advance in each round by clicking the blue and gold paths.
        </Callout>
      )}
    </>
  );
}
