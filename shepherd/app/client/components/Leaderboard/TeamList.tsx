import * as React from 'react';
import { InputGroup, NumericInput } from '@blueprintjs/core';

import RobotSettings from './RobotSettings';
import EntityTable from '../EntityTable';
import { DeleteButton } from '../EntityButtons';
import { AllianceSelect } from '../EntitySelects';
import { PLACEHOLDER } from '../Util';
import { useAppDispatch, useAppSelector, useTeams } from '../../hooks';
import teamsSlice from '../../store/teams';

export default function TeamList(props: { edit: boolean }) {
  const dispatch = useAppDispatch();
  const teams = useTeams();
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
      emptyMessage="No teams"
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
                onSelect={({ id: alliance }) =>
                  dispatch(teamsSlice.actions.upsert({ ...team, alliance }))
                }
              />
            ) : (
              team.allianceData?.name || PLACEHOLDER
            )}
          </td>
          {!props.edit && <td>{team.wins ?? '0'}</td>}
          {!props.edit && <td>{team.losses ?? '0'}</td>}
          {props.edit && <td><RobotSettings team={team} /></td>}
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
