import * as React from 'react';
import {
  Button,
  ButtonGroup,
  EditableText,
  H2,
  HTMLTable,
  IButtonProps,
  InputGroup,
  Intent,
  MenuItem,
  NumericInput,
} from '@blueprintjs/core';
import { Select } from '@blueprintjs/select';
import * as _ from 'lodash';
import { IconNames } from '@blueprintjs/icons';
import { useAppDispatch, useAppSelector } from '../store';
import alliancesSlice, * as allianceUtils from '../store/alliances';
import teamsSlice, * as teamUtils from '../store/teams';

const DeleteButton = (props: IButtonProps) => (
  <Button minimal icon={IconNames.CROSS} intent={Intent.DANGER} {...props} />
);

const DEV_ENV = process.env.NODE_ENV === 'development';
const PLACEHOLDER = <>&mdash;</>;

interface EntityTableProps<T> {
  columns: Array<{ field: string; heading: string }>;
  entities: Array<T>;
  render: (entity: T, index?: number) => React.ReactNode;
  emptyMessage?: string;
}

function EntityTable<T>(props: EntityTableProps<T>) {
  const [sortedBy, setSortedBy] = React.useState<string | null>(null);
  const [ascending, setAscending] = React.useState(false);
  let entities = _.sortBy(props.entities, sortedBy ? [sortedBy] : []);
  if (!ascending) {
    entities = _.reverse(entities);
  }
  const selectSortIcon = (field: string) => {
    if (field !== sortedBy) {
      return IconNames.DOUBLE_CARET_VERTICAL;
    } else if (ascending) {
      return IconNames.CARET_UP;
    } else {
      return IconNames.CARET_DOWN;
    }
  };
  return (
    <HTMLTable striped className="entity-table">
      <thead>
        <tr>
          {props.columns.map((column, index) => (
            <td key={index}>
              {column.heading}
              <Button
                minimal
                className="sort-button"
                icon={selectSortIcon(column.field)}
                onClick={() => {
                  if (column.field !== sortedBy) {
                    setSortedBy(column.field);
                    setAscending(true);
                  } else {
                    setAscending(!ascending);
                  }
                }}
              />
            </td>
          ))}
        </tr>
      </thead>
      <tbody>
        {entities.map((entity, index) => props.render(entity, index))}
        {entities.length === 0 && (
          <tr>
            <td colSpan={props.columns.length} className="empty-row">
              {props.emptyMessage || 'No entities'}
            </td>
          </tr>
        )}
      </tbody>
    </HTMLTable>
  );
}

const AllianceSelect = Select.ofType<allianceUtils.Alliance>();

function TeamsRoster(props: { edit: boolean }) {
  const dispatch = useAppDispatch();
  const teamsState = useAppSelector((state) => state.teams);
  const teams = teamUtils.selectors.selectAll(teamsState);
  const alliancesState = useAppSelector((state) => state.alliances);
  const alliances = allianceUtils.selectors.selectAll(alliancesState);
  return (
    <EntityTable
      columns={[
        { field: 'name', heading: 'Name' },
        { field: 'number', heading: 'Number' },
        { field: 'alliance', heading: 'Alliance' },
        ...(props.edit
          ? []
          : [
              { field: 'wins', heading: 'Wins' },
              { field: 'losses', heading: 'Losses' },
            ]),
      ]}
      entities={teams}
      render={(team) => {
        const alliance = team.alliance
          ? allianceUtils.selectors.selectById(alliancesState, team.alliance)
          : null;
        return (
          <tr key={team.id}>
            <td>
              {props.edit ? (
                <InputGroup
                  placeholder="Enter a name"
                  defaultValue={team.name}
                  onBlur={({ currentTarget: { value: name } }) =>
                    dispatch(teamsSlice.actions.upsert({ ...team, name }))
                  }
                />
              ) : (
                team.name || PLACEHOLDER
              )}
            </td>
            <td>
              {props.edit ? (
                <NumericInput
                  fill
                  allowNumericCharactersOnly
                  min={0}
                  clampValueOnBlur
                  minorStepSize={null}
                  defaultValue={team.number}
                  onValueChange={(number) =>
                    dispatch(teamsSlice.actions.upsert({ ...team, number }))
                  }
                />
              ) : (
                team.number ?? PLACEHOLDER
              )}
            </td>
            <td>
              {props.edit ? (
                <AllianceSelect
                  items={alliances.filter((alliance) => alliance.id >= 0)}
                  itemPredicate={(query, alliance) =>
                    alliance.name.toLowerCase().includes(query.toLowerCase())
                  }
                  itemRenderer={(alliance, { handleClick }) => (
                    <MenuItem
                      key={alliance.id}
                      text={alliance.name}
                      onClick={handleClick}
                    />
                  )}
                  onItemSelect={(alliance) => {
                    dispatch(
                      teamsSlice.actions.upsert({ ...team, alliance: alliance.id })
                    );
                  }}
                  noResults={<MenuItem disabled text="No available alliances." />}
                >
                  <Button
                    icon={IconNames.PEOPLE}
                    rightIcon={IconNames.CARET_DOWN}
                    text={alliance?.name ?? '(None)'}
                  />
                </AllianceSelect>
              ) : (
                alliance?.name || PLACEHOLDER
              )}
            </td>
            {!props.edit && <td>{team.wins ?? '0'}</td>}
            {!props.edit && <td>{team.losses ?? '0'}</td>}
            {props.edit && (
              <td>
                <DeleteButton
                  onClick={() => dispatch(teamsSlice.actions.remove(team.id))}
                />
              </td>
            )}
          </tr>
        );
      }}
    />
  );
}

function AlliancesRoster(props: { edit: boolean }) {
  const dispatch = useAppDispatch();
  const teamsState = useAppSelector((state) => state.teams);
  const teams = teamUtils.selectors.selectAll(teamsState);
  const teamsByAlliance = _.groupBy(teams, (team) => team.alliance);
  const alliancesState = useAppSelector((state) => state.alliances);
  const alliances = allianceUtils.selectors.selectAll(alliancesState);
  return (
    <EntityTable
      columns={[
        { field: 'name', heading: 'Name' },
        { field: 'teams', heading: 'Teams' },
        ...(props.edit
          ? []
          : [
              { field: 'wins', heading: 'Wins' },
              { field: 'losses', heading: 'Losses' },
            ]),
      ]}
      entities={alliances}
      render={(alliance) => (
        <tr key={alliance.id}>
          <td>
            {props.edit ? (
              <InputGroup
                placeholder="Enter a name"
                defaultValue={alliance.name}
                onBlur={({ currentTarget: { value: name } }) => {
                  dispatch(alliancesSlice.actions.upsert({ ...alliance, name }));
                }}
              />
            ) : (
              alliance.name || PLACEHOLDER
            )}
          </td>
          <td>
            {(teamsByAlliance[alliance.id] ?? [])
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((team) => `${team.name} (#${team.number})`)
              .join(', ') || PLACEHOLDER}
          </td>
          {!props.edit && <td>{alliance.wins ?? '0'}</td>}
          {!props.edit && <td>{alliance.losses ?? '0'}</td>}
          {props.edit && (
            <td>
              <DeleteButton
                onClick={() => dispatch(alliancesSlice.actions.remove(alliance.id))}
              />
            </td>
          )}
        </tr>
      )}
    />
  );
}

export default function Leaderboard() {
  const dispatch = useAppDispatch();
  const username = useAppSelector((state) => state.user.username);
  const [edit, setEdit] = React.useState(false);
  React.useEffect(() => {
    dispatch(allianceUtils.fetch());
    dispatch(teamUtils.fetch());
  }, [dispatch]);
  return (
    <>
      <div className="container">
        <div className="column">
          <H2>Teams</H2>
          <TeamsRoster edit={edit} />
        </div>
        <div className="column">
          <H2>Alliances</H2>
          <AlliancesRoster edit={edit} />
        </div>
      </div>
      {(username || DEV_ENV) && (
        <div className="leaderboard-buttons">
          <ButtonGroup>
            <Button
              text={edit ? 'View' : 'Edit'}
              icon={edit ? IconNames.EYE_OPEN : IconNames.EDIT}
              onClick={() => setEdit(!edit)}
            />
            {edit && (
              <>
                <Button
                  text="Add team"
                  intent={Intent.PRIMARY}
                  icon={IconNames.ADD}
                  onClick={() => dispatch(teamUtils.add())}
                />
                <Button
                  text="Add alliance"
                  intent={Intent.PRIMARY}
                  icon={IconNames.ADD}
                  onClick={() => dispatch(allianceUtils.add())}
                />
                <Button
                  text="Confirm"
                  intent={Intent.SUCCESS}
                  icon={IconNames.TICK}
                  onClick={() => {
                    dispatch(teamUtils.save());
                    dispatch(allianceUtils.save());
                    setEdit(false);
                  }}
                />
              </>
            )}
          </ButtonGroup>
        </div>
      )}
    </>
  );
}
