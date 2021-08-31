import * as React from 'react';
import {
  Button,
  ButtonGroup,
  EditableText,
  H2,
  InputGroup,
  Intent,
  NumericInput,
} from '@blueprintjs/core';
import * as _ from 'lodash';
import { IconNames } from '@blueprintjs/icons';

import EntityTable from './EntityTable';
import { AddButton, ConfirmButton, DeleteButton, EditButton } from './EntityButtons';
import { select, AllianceSelect } from './EntitySelects';
import { PLACEHOLDER, DEV_ENV, TeamMembers } from './Util';

import { useAppDispatch, useAppSelector } from '../store';
import alliancesSlice, * as allianceUtils from '../store/alliances';
import teamsSlice, * as teamUtils from '../store/teams';

function TeamsRoster(props: { edit: boolean }) {
  const dispatch = useAppDispatch();
  const teamsState = useAppSelector((state) => state.teams);
  const teams = teamUtils.selectors.selectAll(teamsState);
  const alliancesState = useAppSelector((state) => state.alliances);
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
      render={(team) => (
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
                id={team.alliance}
                onSelect={(alliance) =>
                  dispatch(
                    teamsSlice.actions.upsert({ ...team, alliance: alliance.id })
                  )
                }
              />
            ) : (
              select(allianceUtils.selectors, alliancesState, team.alliance)?.name ||
              PLACEHOLDER
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
      )}
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
  // TODO: do not break team number from name
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
            <TeamMembers teams={teamsByAlliance[alliance.id] ?? []} />
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
        <ButtonGroup className="spacer">
          <EditButton edit={edit} setEdit={setEdit} />
          {edit && (
            <>
              <AddButton text="Add team" onClick={() => dispatch(teamUtils.add())} />
              <AddButton
                text="Add alliance"
                onClick={() => dispatch(allianceUtils.add())}
              />
              <ConfirmButton
                onClick={() => {
                  dispatch(teamUtils.save());
                  dispatch(allianceUtils.save());
                  setEdit(false);
                }}
              />
            </>
          )}
        </ButtonGroup>
      )}
    </>
  );
}
