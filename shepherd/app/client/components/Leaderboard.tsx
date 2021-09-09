import * as React from 'react';
import {
  Button,
  ButtonGroup,
  Classes,
  Dialog,
  FormGroup,
  H2,
  InputGroup,
  Intent,
  NumericInput,
} from '@blueprintjs/core';
import * as _ from 'lodash';
import { IconName, IconNames } from '@blueprintjs/icons';

import EntityTable from './EntityTable';
import { AddButton, ConfirmButton, DeleteButton, EditButton } from './EntityButtons';
import { select, AllianceSelect } from './EntitySelects';
import { OutcomeButton, notifySuccess, notifyFailure } from './Notification';
import { PLACEHOLDER, DEV_ENV, TeamMembers } from './Util';

import { useAppDispatch, useAppSelector } from '../store';
import alliancesSlice, * as allianceUtils from '../store/alliances';
import teamsSlice, * as teamUtils from '../store/teams';
import { LogLevel, Team } from '../../types';

const portInputOptions = {
  minorStepSize: null,
  min: 1,
  max: 65535,
  leftIcon: IconNames.FLOW_END as IconName,
  majorStepSize: 10,
  clampValueOnBlur: true,
};

function RobotSettings(props: { team: Team }) {
  const dispatch = useAppDispatch();
  const [show, setShow] = React.useState(false);
  return (
    <>
      <Button
        text="Settings"
        icon={IconNames.SETTINGS}
        onClick={() => setShow(!show)}
      />
      <Dialog
        isOpen={show}
        icon={IconNames.SETTINGS}
        title="Edit robot settings"
        onClose={() => setShow(false)}
      >
        <div className={Classes.DIALOG_BODY}>
          <FormGroup
            label="Hostname"
            helperText="Either an IP address or a domain name for Shepherd to connect to."
          >
            <InputGroup
              placeholder="Example: 192.168.1.1"
              defaultValue={props.team.hostname}
              onBlur={({ currentTarget: { value: hostname } }) =>
                dispatch(teamsSlice.actions.upsert({ ...props.team, hostname }))
              }
            />
          </FormGroup>
          <FormGroup
            label="Remote call port"
            helperText="Port that Shepherd should connect to for sending calls."
          >
            <NumericInput
              {...portInputOptions}
              defaultValue={props.team.callPort}
              onValueChange={(callPort) =>
                callPort > 0 &&
                dispatch(teamsSlice.actions.upsert({ ...props.team, callPort }))
              }
            />
          </FormGroup>
          <FormGroup
            label="Log publisher port"
            helperText="Port that Shepherd should connect to for receiving logged events."
          >
            <NumericInput
              {...portInputOptions}
              defaultValue={props.team.logPort}
              onValueChange={(logPort) =>
                logPort > 0 &&
                dispatch(teamsSlice.actions.upsert({ ...props.team, logPort }))
              }
            />
          </FormGroup>
          <FormGroup
            label="Update port"
            helperText="Port that Shepherd should bind to for receiving Smart Device updates."
          >
            <NumericInput
              {...portInputOptions}
              defaultValue={props.team.updatePort}
              onValueChange={(updatePort) =>
                updatePort > 0 &&
                dispatch(teamsSlice.actions.upsert({ ...props.team, updatePort }))
              }
            />
          </FormGroup>
          <FormGroup
            label="Multicast group"
            helperText="IP multicast group Runtime uses to broadcast Smart Device updates."
          >
            <InputGroup
              placeholder="Example: 224.224.1.1"
              defaultValue={props.team.multicastGroup}
              onBlur={({ currentTarget: { value: multicastGroup } }) =>
                dispatch(teamsSlice.actions.upsert({ ...props.team, multicastGroup }))
              }
            />
          </FormGroup>
        </div>
        <div className={Classes.DIALOG_FOOTER}>
          <div className={Classes.DIALOG_FOOTER_ACTIONS}>
            <OutcomeButton
              icon={IconNames.CONFIRM}
              intent={Intent.SUCCESS}
              text="Confirm"
              onClick={async () => {
                try {
                  await dispatch(teamUtils.save()).unwrap();
                  notifySuccess('Saved team settings.');
                  setShow(false);
                } catch {
                  notifyFailure('Failed to save team settings.');
                }
              }}
            />
          </div>
        </div>
      </Dialog>
    </>
  );
}

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
              <RobotSettings team={team} />
            </td>
          )}
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
      emptyMessage="No alliances"
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
