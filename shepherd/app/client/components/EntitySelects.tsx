import * as React from 'react';
import { EntityState, EntitySelectors } from '@reduxjs/toolkit';
import { Button, HTMLSelect, MenuItem } from '@blueprintjs/core';
import { IconName, IconNames } from '@blueprintjs/icons';
import { Select } from '@blueprintjs/select';
import { useAppSelector } from '../hooks';
import type { RootState } from '../store';
import * as allianceUtils from '../store/alliances';
import * as bracketUtils from '../store/bracket';
import * as teamUtils from '../store/teams';
import * as matchUtils from '../store/matches';
import { Alliance, AllianceColor, Fixture, Match, MatchEventType, Team } from '../../types';

interface EntitySelectProps<T> {
  id?: null | number;
  onSelect: (entity: T) => void;
  noResults?: string;
  placeholder?: string;
  disabled?: boolean;
}

// TODO: move to Util
export function select<T>(
  selectors: EntitySelectors<T, EntityState<T>>,
  state: EntityState<T>,
  id?: null | number
) {
  return id !== undefined && id !== null && !isNaN(id)
    ? selectors.selectById(state, id)
    : undefined;
}

function makeSelect<T extends { id: number }>(
  selectState: (state: RootState) => EntityState<T>,
  selectors: EntitySelectors<T, EntityState<T>>,
  selectName: (entity?: T) => string,
  icon?: IconName
) {
  const SelectFactory = Select.ofType<T>();
  return (props: EntitySelectProps<T>) => {
    const entityState = useAppSelector(selectState);
    const entities = selectors.selectAll(entityState);
    const entity = select(selectors, entityState, props.id);
    return (
      <SelectFactory
        disabled={props.disabled}
        items={entities.filter((entity) => entity.id >= 0)}
        itemPredicate={(query, entity) =>
          selectName(entity).toLowerCase().includes(query.toLowerCase())
        }
        itemRenderer={(entity, { handleClick }) => (
          <MenuItem key={entity.id} text={selectName(entity)} onClick={handleClick} />
        )}
        onItemSelect={(entity) => props.onSelect(entity)}
        noResults={<MenuItem disabled text={props.noResults || 'No results.'} />}
      >
        <Button
          disabled={props.disabled}
          icon={icon}
          rightIcon={IconNames.CARET_DOWN}
          text={selectName(entity) || props.placeholder || '(None)'}
        />
      </SelectFactory>
    );
  };
}

export const AllianceSelect = makeSelect<Alliance>(
  (state) => state.alliances,
  allianceUtils.selectors,
  (alliance) => alliance?.name ?? '',
  IconNames.PEOPLE
);

const FixtureSelectFactory = Select.ofType<Fixture>();

export function FixtureSelect(props: EntitySelectProps<Fixture>) {
  const alliancesState = useAppSelector((state) => state.alliances);
  const bracket = useAppSelector((state) => state.bracket);
  const fixtures = bracketUtils
    .getFixtures(bracket)
    .filter((fixture) => fixture.blue?.winner || fixture.gold?.winner);
  let fixture = undefined;
  if (props.id) {
    [fixture] = fixtures.filter((fixture) => fixture.id === props.id);
  }
  const selectName = (fixture?: Fixture) => {
    if (!fixture) {
      return '';
    }
    const blue = select(allianceUtils.selectors, alliancesState, fixture.blue?.winner);
    const gold = select(allianceUtils.selectors, alliancesState, fixture.gold?.winner);
    return `${blue?.name ?? '?'} vs. ${gold?.name ?? '?'}`;
  };
  return (
    <FixtureSelectFactory
      disabled={props.disabled}
      items={fixtures}
      itemPredicate={(query, fixture) =>
        selectName(fixture).toLowerCase().includes(query.toLowerCase())
      }
      itemRenderer={(fixture, { handleClick }) =>
        <MenuItem key={fixture.id} text={selectName(fixture)} onClick={handleClick} />
      }
      onItemSelect={(fixture) => props.onSelect(fixture)}
      noResults={<MenuItem disabled text={props.noResults || 'No results.'} />}
    >
      <Button
        disabled={props.disabled}
        icon={IconNames.MANY_TO_ONE}
        rightIcon={IconNames.CARET_DOWN}
        text={selectName(fixture) || props.placeholder || '(None)'}
      />
    </FixtureSelectFactory>
  );
}

export const TeamSelect = makeSelect<Team>(
  (state) => state.teams,
  teamUtils.selectors,
  (team) => team?.name ?? ''
);

export const MatchSelect = makeSelect<Match>(
  (state) => state.matches,
  matchUtils.selectors,
  (match) => (match?.id !== undefined ? `Match ${match.id}` : '')
);

interface EnumSelectProps<T> {
  value: T;
  setValue: (alliance: T) => void;
  disabled?: boolean;
}

export function AllianceColorSelect(props: EnumSelectProps<AllianceColor>) {
  return (
    <HTMLSelect
      value={props.value}
      onChange={({ currentTarget: { value } }) =>
        props.setValue(value as AllianceColor)
      }
      disabled={props.disabled}
    >
      <option value={AllianceColor.NONE}>None</option>
      <option value={AllianceColor.BLUE}>Blue</option>
      <option value={AllianceColor.GOLD}>Gold</option>
    </HTMLSelect>
  );
}

export function MatchEventTypeSelect(props: EnumSelectProps<MatchEventType>) {
  return (
    <HTMLSelect
      value={props.value}
      onChange={({ currentTarget: { value } }) =>
        props.setValue(value as MatchEventType)
      }
      disabled={props.disabled}
    >
      <option value={MatchEventType.JOIN}>Join an alliance</option>
      <option value={MatchEventType.AUTO}>Start autonomous</option>
      <option value={MatchEventType.TELEOP}>Start tele-op</option>
      <option value={MatchEventType.IDLE}>Stop phase</option>
      <option value={MatchEventType.ESTOP}>E-stop</option>
      <option value={MatchEventType.ADD}>Add to score</option>
      <option value={MatchEventType.MULTIPLY}>Apply score multiplier</option>
      <option value={MatchEventType.EXTEND}>Extend match phase</option>
      <option value={MatchEventType.OTHER}>Other</option>
    </HTMLSelect>
  );
}
