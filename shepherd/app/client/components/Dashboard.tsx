import * as React from 'react';
import {
  Button,
  ButtonGroup,
  Checkbox,
  ControlGroup,
  FormGroup,
  H2,
  HTMLSelect,
  HTMLTable,
  Intent,
  InputGroup,
  NonIdealState,
  NumericInput,
} from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import * as _ from 'lodash';
import { DeleteButton } from './EntityButtons';
import EntityTable from './EntityTable';
import { select, AllianceColorSelect, MatchSelect, TeamSelect } from './EntitySelects';
import { PLACEHOLDER, AlertButton } from './Util';
import { useAppDispatch, useAppSelector } from '../store';
import * as controlUtils from '../store/control';
import teamsSlice, * as teamUtils from '../store/teams';
import * as matchUtils from '../store/matches';
import {
  AllianceColor,
  GameState,
  Match,
  MatchEvent,
  MatchEventType,
  MatchPhase,
  Team,
  displayAllianceColor,
  displayPhase,
  displayTeam,
} from '../../types';

function useMatch() {
  const matchId = useAppSelector((state) => state.control.matchId);
  const matchesState = useAppSelector((state) => state.matches);
  return select(matchUtils.selectors, matchesState, matchId);
}

function MatchConnector(props: { phase: MatchPhase; totalTime: number }) {
  const dispatch = useAppDispatch();
  const currentMatchId = useAppSelector((state) => state.control.matchId);
  const [matchId, setMatchId] = React.useState<number | null>(currentMatchId);
  return (
    <FormGroup
      label="Select a match to play"
      helperText="Connect to robots and initialize the scoreboard."
    >
      <ControlGroup>
        <MatchSelect id={matchId} onSelect={(match) => setMatchId(match.id)} />
        <Button
          text="Connect"
          disabled={matchId === null}
          intent={Intent.PRIMARY}
          icon={IconNames.CELL_TOWER}
          onClick={() => {
            dispatch(
              controlUtils.send({
                matchId,
                timer: {
                  phase: props.phase,
                  timeRemaining: props.totalTime * 1000,
                  totalTime: props.totalTime * 1000,
                  stage: 'init',
                },
              })
            );
          }}
        />
      </ControlGroup>
    </FormGroup>
  );
}

const getSelectedTeams = (selection: TeamSelection) =>
  _.chain(selection)
    .pickBy()
    .keys()
    .map((team) => Number(team))
    .value();

type Mode =
  | MatchEventType.AUTO
  | MatchEventType.TELEOP
  | MatchEventType.IDLE
  | MatchEventType.ESTOP;

function TimerControl(props: { teamSelection: TeamSelection }) {
  const dispatch = useAppDispatch();
  const match = useMatch();
  const teamsState = useAppSelector((state) => state.teams);
  const [phase, setPhase] = React.useState(MatchPhase.AUTO);
  // TODO: infer match defaults
  const [totalTime, setTotalTime] = React.useState(
    phase === MatchPhase.AUTO ? 30 : 180
  );
  const teamSelection = getSelectedTeams(props.teamSelection);
  const changeMode = (mode: Mode, totalTime?: number) => {
    if (!match) {
      return;
    }
    const events = teamSelection.map((team) => ({
      match: match.id,
      type: mode,
      team,
      value: totalTime,
    }));
    dispatch(controlUtils.send({ events }));
  };
  const warnings = _.every(props.teamSelection)
    ? []
    : [
        'Are you sure you want to change the running state of only some robots? ' +
          'Robots are normally started or stopped all together.',
      ];
  const disabled = teamSelection.length === 0;
  return (
    <>
      <MatchConnector phase={phase} totalTime={totalTime} />
      <FormGroup
        label="Start or stop robots"
        helperText={
          'Activate the robots selected in the table below. ' +
          'The robots will shut off automatically after the number of seconds given.'
        }
      >
        <ControlGroup>
          <HTMLSelect
            value={phase}
            onChange={({ currentTarget: { value } }) => setPhase(value as MatchPhase)}
            disabled={disabled}
          >
            <option value={MatchPhase.AUTO}>{displayPhase(MatchPhase.AUTO)}</option>
            <option value={MatchPhase.TELEOP}>{displayPhase(MatchPhase.TELEOP)}</option>
          </HTMLSelect>
          <NumericInput
            allowNumericCharactersOnly
            clampValueOnBlur
            placeholder="Number of seconds"
            disabled={disabled}
            min={0}
            defaultValue={totalTime}
            onValueChange={(totalTime) => setTotalTime(totalTime)}
          />
          <AlertButton
            getWarnings={() => warnings}
            disabled={disabled}
            text="Start"
            intent={Intent.PRIMARY}
            icon={IconNames.PLAY}
            onClick={() =>
              changeMode(
                phase === MatchPhase.AUTO ? MatchEventType.AUTO : MatchEventType.TELEOP,
                totalTime * 1000
              )
            }
          />
          <AlertButton
            getWarnings={() => [
              ...warnings,
              'Are you sure you want to preemptively stop the match? ' +
                'Shepherd normally stops robots automatically.',
            ]}
            disabled={disabled}
            text="Stop"
            intent={Intent.WARNING}
            icon={IconNames.STOP}
            onClick={() => changeMode(MatchEventType.IDLE)}
          />
          <AlertButton
            getWarnings={() => [
              ...warnings,
              'Are you sure you want to e-stop one or more robots? ' +
                'E-stopped robots cannot be restarted.',
            ]}
            disabled={disabled}
            text="E-Stop"
            intent={Intent.DANGER}
            icon={IconNames.FLAME}
            onClick={() => changeMode(MatchEventType.ESTOP)}
          />
        </ControlGroup>
      </FormGroup>
    </>
  );
}

function TimerExtender(props: { teamSelection: TeamSelection }) {
  const dispatch = useAppDispatch();
  const matchId = useAppSelector((state) => state.control.matchId);
  const [extension, setExtension] = React.useState(0);
  const teamSelection = getSelectedTeams(props.teamSelection);
  const disabled = teamSelection.length === 0;
  return (
    <FormGroup
      label="Extend the match"
      helperText="Manually delay the shutoff of the selected robots."
    >
      <ControlGroup>
        <NumericInput
          allowNumericCharactersOnly
          clampValueOnBlur
          disabled={disabled}
          placeholder="Number of seconds"
          min={0}
          defaultValue={extension}
          onValueChange={(extension) => setExtension(extension)}
        />
        <Button
          disabled={disabled}
          text="Add time"
          intent={Intent.SUCCESS}
          icon={IconNames.TIME}
          onClick={() => {
            if (matchId !== null && extension > 0) {
              const events = teamSelection.map((team) => ({
                match: matchId,
                type: MatchEventType.EXTEND,
                team,
                value: extension * 1000,
              }));
              dispatch(controlUtils.send({ events, activations: teamSelection }));
            }
          }}
        />
      </ControlGroup>
    </FormGroup>
  );
}

interface TeamSelection {
  [teamId: number]: boolean;
}

interface TeamConnectionTableProps {
  teamSelection: TeamSelection;
  setTeamSelection: (teams: TeamSelection) => void;
}

function TeamConnectionTable(props: TeamConnectionTableProps) {
  const dispatch = useAppDispatch();
  const robots = useAppSelector((state) => state.control.robots);
  const teamsState = useAppSelector((state) => state.teams);
  const match = useMatch();
  const game = GameState.fromEvents(match?.events ?? []);
  // TODO: higher update frequency
  const allChecked = _.every(props.teamSelection);
  const toggleTeamSelection = (teamId: number) =>
    props.setTeamSelection({
      ...props.teamSelection,
      [teamId]: !props.teamSelection[teamId],
    });
  // TODO: sort by alliance
  return (
    <HTMLTable striped>
      <thead>
        <tr>
          <td>
            <Checkbox
              checked={allChecked}
              onChange={() =>
                props.setTeamSelection(
                  _.mapValues(props.teamSelection, (value) => !allChecked)
                )
              }
            />
          </td>
          <td>Alliance</td>
          <td>Team</td>
          <td>Hostname</td>
          <td>Update Rate</td>
          <td>UIDs</td>
        </tr>
      </thead>
      <tbody>
        {robots.length === 0 && (
          <tr>
            <td colSpan={6} className="empty-row">
              No teams connected
            </td>
          </tr>
        )}
        {robots.map((robot) => {
          const team = teamUtils.selectors.selectById(teamsState, robot.teamId);
          if (!team) {
            return;
          }
          const checked = props.teamSelection[team.id] ?? false;
          return (
            <tr key={team.id}>
              <td>
                <Checkbox
                  checked={checked}
                  onChange={() => toggleTeamSelection(team.id)}
                />
              </td>
              <td>{displayAllianceColor(game.getAlliance(team.id))}</td>
              <td>{displayTeam(team)}</td>
              <td>
                <code>{team.hostname || PLACEHOLDER}</code>
              </td>
              <td>{robot.updateRate.toFixed(2)} updates per second</td>
              <td>{robot.uids.join(', ') || PLACEHOLDER}</td>
              <td>
                <DeleteButton
                  onClick={async () => {
                    if (!match) {
                      return;
                    }
                    const query = { type: MatchEventType.JOIN, team: team.id };
                    const [target] = matchUtils.queryEvent(match, query);
                    if (target) {
                      dispatch(matchUtils.removeEvent(match, target.id));
                      await dispatch(matchUtils.save()).unwrap();
                      dispatch(controlUtils.send({}));
                    }
                  }}
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </HTMLTable>
  );
}

function TeamAdder() {
  const dispatch = useAppDispatch();
  const match = useMatch();
  const teamsState = useAppSelector((state) => state.teams);
  const [teamId, setTeamId] = React.useState<number | null>(null);
  const [alliance, setAlliance] = React.useState(AllianceColor.NONE);
  const [hostname, setHostname] = React.useState('');
  return (
    <FormGroup
      label="Add teams"
      helperText="Assign a team to an alliance. Optionally, you may change the hostname of a team's robot."
    >
      <ControlGroup>
        <AllianceColorSelect
          disabled={!match}
          alliance={alliance}
          setAlliance={setAlliance}
        />
        <TeamSelect
          disabled={!match}
          id={teamId}
          onSelect={(team) => setTeamId(team.id)}
        />
        <InputGroup
          disabled={!match}
          placeholder="Example: 192.168.1.1"
          onBlur={({ currentTarget: { value } }) => setHostname(value)}
        />
        <Button
          text="Add team"
          icon={IconNames.ADD}
          intent={Intent.SUCCESS}
          disabled={!match || teamId === null}
          onClick={async () => {
            const team = select(teamUtils.selectors, teamsState, teamId);
            if (!match || !team) {
              // Satisfy the typechecker
              return;
            }
            if (hostname) {
              dispatch(teamsSlice.actions.upsert({ ...team, hostname }));
              await dispatch(teamUtils.save()).unwrap();
            }
            const query = { type: MatchEventType.JOIN, team: teamId };
            const [target] = matchUtils.queryEvent(match, query);
            if (target) {
              dispatch(matchUtils.updateEvent(match, target.id, { alliance }));
            } else {
              dispatch(matchUtils.addEvent(match, { ...query, alliance }));
            }
            await dispatch(matchUtils.save()).unwrap();
            dispatch(controlUtils.send({ matchId: match.id }));
          }}
        />
      </ControlGroup>
    </FormGroup>
  );
}

function ScoreAdjustment() {
  const dispatch = useAppDispatch();
  const match = useMatch();
  const [alliance, setAlliance] = React.useState(AllianceColor.NONE);
  const [points, setPoints] = React.useState(0);
  return (
    <FormGroup
      label="Adjust scores"
      helperText="Add or subtract points from an alliance's score."
    >
      <ControlGroup>
        <AllianceColorSelect
          disabled={!match}
          alliance={alliance}
          setAlliance={setAlliance}
        />
        <NumericInput
          allowNumericCharactersOnly
          disabled={!match}
          placeholder="Number of points"
          defaultValue={points}
          onValueChange={(value) => setPoints(value)}
        />
        <Button
          disabled={!match || points === 0}
          text="Add score"
          icon={IconNames.ADD}
          intent={Intent.SUCCESS}
          onClick={async () => {
            if (match && points !== 0) {
              dispatch(
                matchUtils.addEvent(match, {
                  type: MatchEventType.ADD,
                  alliance,
                  value: points,
                  description: 'Score manually adjusted by referee.',
                })
              );
              await dispatch(matchUtils.save()).unwrap();
            }
          }}
        />
      </ControlGroup>
    </FormGroup>
  );
}

function MatchControl() {
  const matchId = useAppSelector((state) => state.control.matchId);
  const robots = useAppSelector((state) => state.control.robots);
  const [teamSelection, setTeamSelection] = React.useState<TeamSelection>({});
  React.useEffect(() => {
    const selection = _.fromPairs(
      robots.map((robot) => [robot.teamId, teamSelection[robot.teamId] ?? true])
    );
    if (!_.isEqual(selection, teamSelection)) {
      setTeamSelection(selection);
    }
  }, [robots, teamSelection, setTeamSelection]);
  return (
    <>
      <div className="control-bar spacer">
        <TimerControl teamSelection={teamSelection} />
        <TimerExtender teamSelection={teamSelection} />
      </div>
      {matchId !== null ? (
        <TeamConnectionTable
          teamSelection={teamSelection}
          setTeamSelection={setTeamSelection}
        />
      ) : (
        <NonIdealState
          className="no-match"
          icon={IconNames.OFFLINE}
          title="No match selected"
          description="Select a match to play."
        />
      )}
      <div className="control-bar spacer">
        <TeamAdder />
        <ScoreAdjustment />
      </div>
    </>
  );
}

// TODO: add logs
export default function Dashboard() {
  return (
    <>
      <MatchControl />
    </>
  );
}
