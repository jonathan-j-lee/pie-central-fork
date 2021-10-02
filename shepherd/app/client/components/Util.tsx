import { Team, displayTeam } from '../../types';
import * as React from 'react';

export const DEV_ENV = process.env.NODE_ENV === 'development';
export const PLACEHOLDER = <>&mdash;</>;

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
