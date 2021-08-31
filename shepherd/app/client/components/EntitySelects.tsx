import * as React from 'react';
import { EntityState, EntitySelectors } from '@reduxjs/toolkit';
import { Button, HTMLSelect, MenuItem } from '@blueprintjs/core';
import { IconName, IconNames } from '@blueprintjs/icons';
import { Select } from '@blueprintjs/select';
import type { RootState } from '../store';
import { useAppSelector } from '../store';
import * as allianceUtils from '../store/alliances';
import * as teamUtils from '../store/teams';
import * as matchUtils from '../store/matches';
import { Alliance, AllianceColor, Match, Team } from '../../types';

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

interface AllianceColorSelectProps {
  alliance: AllianceColor;
  setAlliance: (alliance: AllianceColor) => void;
  disabled?: boolean;
}

export function AllianceColorSelect(props: AllianceColorSelectProps) {
  return (
    <HTMLSelect
      value={props.alliance}
      onChange={({ currentTarget: { value } }) =>
        props.setAlliance(value as AllianceColor)
      }
      disabled={props.disabled}
    >
      <option value={AllianceColor.NONE}>None</option>
      <option value={AllianceColor.BLUE}>Blue</option>
      <option value={AllianceColor.GOLD}>Gold</option>
    </HTMLSelect>
  );
}
