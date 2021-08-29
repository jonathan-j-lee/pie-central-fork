import * as React from 'react';
import * as _ from 'lodash';
import { Team } from '../store/teams';

export const DEV_ENV = process.env.NODE_ENV === 'development';
export const PLACEHOLDER = <>&mdash;</>;

export const displayTeam = (team?: Team) =>
  team?.name ? `${team.name} (#${team.number})` : PLACEHOLDER;

export function TeamMembers(props: { teams: Team[] }) {
  return props.teams.length ? (
    <>
      {props.teams
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((team) => displayTeam(team))
        .join(', ')}
    </>
  ) : (
    PLACEHOLDER
  );
}

export const displayTime = (duration: number, places: number = 1) => {
  const minutes = Math.trunc(duration / 60)
    .toString()
    .padStart(2, '0');
  const seconds = duration % 60;
  const secondsFormatted = (seconds < 10 ? '0' : '') + seconds.toFixed(places);
  return `${minutes}:${secondsFormatted}`;
};
