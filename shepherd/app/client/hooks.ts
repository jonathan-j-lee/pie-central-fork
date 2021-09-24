import * as React from 'react';
import { TypedUseSelectorHook, useDispatch, useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';
import * as _ from 'lodash';
import type { AppDispatch, RootState } from './store';
import { selectors as allianceSelectors } from './store/alliances';
import { getFixtures } from './store/bracket';
import { Robot, RobotSelection } from './store/control';
import { selectors as matchSelectors } from './store/matches';
import { selectors as teamSelectors } from './store/teams';
import {
  AllianceColor,
  Fixture,
  GameState,
  RobotStatus,
  Team,
  TimerState,
  countMatchStatistics,
  getAllianceAllegiance,
} from '../types';

export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;

export function useBracket(): [Fixture | null, Fixture[]] {
  const alliances = useAppSelector((state) => state.alliances);
  let bracket = useAppSelector((state) => state.bracket);
  const fixtures: Fixture[] = [];
  bracket = getFixtures(bracket, fixtures, alliances);
  return [bracket, fixtures];
}

export function useAlliances() {
  const alliances = useAppSelector((state) => state.alliances);
  const teams = useAppSelector((state) => state.teams);
  const teamsByAlliance = _.groupBy(
    teamSelectors.selectAll(teams),
    (team) => team.alliance,
  );
  const matches = useMatches();
  const matchId = useAppSelector((state) => state.control.matchId);
  return allianceSelectors
    .selectAll(alliances)
    .map((alliance) => ({
      ...alliance,
      teams: teamsByAlliance[alliance.id] ?? [],
      stats: countMatchStatistics(
        matches.filter((match) => match.id !== matchId && match.game.started),
        (match) => getAllianceAllegiance(alliance, match.fixtureData),
        (match) => match.game,
      ),
    }));
}

export function useTeams(elimination?: boolean) {
  const teams = useAppSelector((state) => state.teams);
  const alliances = useAppSelector((state) => state.alliances);
  const matchesState = useAppSelector((state) => state.matches);
  const matches = useMatches();
  const matchId = useAppSelector((state) => state.control.matchId);
  return teamSelectors
    .selectAll(teams)
    .map((team) => ({
      ...team,
      allianceData: team.alliance
        ? allianceSelectors.selectById(alliances, team.alliance)
        : undefined,
      stats: countMatchStatistics(
        matches.filter((match) =>
          match.id !== matchId && match.game.started && (elimination || !match.fixture)
        ),
        (match) => match.game.getAlliance(team.id),
        (match) => match.game,
      ),
    }));
}

export function useMatches() {
  const teamsState = useAppSelector((state) => state.teams);
  const getTeams = (teamIds: number[]) => {
    const teams = [];
    for (const teamId of teamIds) {
      const team = teamSelectors.selectById(teamsState, teamId);
      if (team) {
        teams.push(team);
      }
    }
    return teams;
  };
  const matches = useAppSelector((state) => state.matches);
  const [, fixtures] = useBracket();
  const fixtureMap = new Map<number, Fixture>();
  for (const fixture of fixtures) {
    fixtureMap.set(fixture.id, fixture);
  }
  return matchSelectors
    .selectAll(matches)
    .map((match) => {
      const game = GameState.fromEvents(match.events);
      return {
        ...match,
        fixtureData: match.fixture ? fixtureMap.get(match.fixture) : undefined,
        game,
        blueScore: game.blue.score,
        goldScore: game.gold.score,
        blueTeams: getTeams(game.blue.teams),
        goldTeams: getTeams(game.gold.teams),
      };
    });
}

export function useQuery() {
  return new URLSearchParams(useLocation().search);
}

export function useCurrentMatch() {
  const matchId = useAppSelector((state) => state.control.matchId);
  const matches = useAppSelector((state) => state.matches);
  return matchId ? matchSelectors.selectById(matches, matchId) : null;
}

export function useRobots(): [Robot[], (changes: RobotSelection) => void] {
  const robots = useAppSelector((state) => state.control.robots) as RobotStatus[];
  const teams = useAppSelector((state) => state.teams);
  const [selection, setSelection] = React.useState<RobotSelection>({});
  React.useEffect(() => {
    const newSelection = _.fromPairs(
      robots.map((robot) => [robot.teamId, selection[robot.teamId] ?? true])
    );
    if (!_.isEqual(selection, newSelection)) {
      setSelection(newSelection);
    }
  }, [robots, selection, setSelection]);
  const robotsWithTeams: Robot[] = [];
  for (const robot of robots) {
    const team = teamSelectors.selectById(teams, robot.teamId);
    if (team) {
      robotsWithTeams.push({ ...robot, team, selected: selection[robot.teamId] });
    }
  }
  return [
    robotsWithTeams,
    (changes: RobotSelection) => setSelection({ ...selection, ...changes }),
  ];
}

// Reconcile timer state
export function useTimer(updateInterval: number = 100): TimerState {
  const control = useAppSelector((state) => state.control);
  const [timeRemaining, setTimeRemaining] = React.useState(control.timer.timeRemaining);
  React.useEffect(() => {
    if (control.timer.timeRemaining <= 0) {
      return;
    }
    if (control.timer.stage !== 'running') {
      setTimeRemaining(control.timer.timeRemaining);
      return;
    }
    let done = false;
    const interval = setInterval(() => {
      const timeElapsed = Date.now() - control.clientTimestamp;
      const timeRemaining = control.timer.timeRemaining - timeElapsed;
      if (timeRemaining > 0) {
        setTimeRemaining(timeRemaining);
      } else {
        setTimeRemaining(0);
        clearInterval(interval);
        done = true;
      }
    }, updateInterval);
    return () => {
      if (!done) {
        clearInterval(interval);
      }
    };
  }, [control, setTimeRemaining]);
  return { ...control.timer, timeRemaining };
}
