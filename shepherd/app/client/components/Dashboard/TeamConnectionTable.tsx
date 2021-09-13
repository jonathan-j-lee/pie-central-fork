import * as React from 'react';
import {
  Checkbox,
  HTMLTable,
} from '@blueprintjs/core';
import * as _ from 'lodash';
import { DeleteButton } from '../EntityButtons';
import { PLACEHOLDER } from '../Util';
import { useAppDispatch, useCurrentMatch } from '../../hooks';
import { disconnectTeam, Robot, RobotSelection } from '../../store/control';
import { GameState, displayAllianceColor, displayTeam } from '../../../types';

interface TeamConnectionTableProps {
  robots: Robot[];
  setSelection: (teams: RobotSelection) => void;
}

export default function TeamConnectionTable(props: TeamConnectionTableProps) {
  const dispatch = useAppDispatch();
  const match = useCurrentMatch();
  const game = GameState.fromEvents(match?.events ?? []);
  // TODO: higher update frequency
  // TODO: sort by alliance
  const allChecked = props.robots.every((robot) => robot.selected);
  return (
    <HTMLTable striped>
      <thead>
        <tr>
          <td>
            <Checkbox
              checked={allChecked}
              onChange={() =>
                props.setSelection(
                  _.fromPairs(props.robots.map((robot) => [robot.teamId, !allChecked]))
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
        {props.robots.length === 0 && (
          <tr><td colSpan={6} className="empty-row">No teams connected</td></tr>
        )}
        {props.robots.map((robot) => (
          <tr key={robot.team.id}>
            <td>
              <Checkbox
                checked={robot.selected ?? false}
                onChange={() =>
                  props.setSelection({ [robot.team.id]: !robot.selected })
                }
              />
            </td>
            <td className={`${game.getAlliance(robot.team.id)} bg`}>
              {displayAllianceColor(game.getAlliance(robot.team.id))}
            </td>
            <td>{displayTeam(robot.team)}</td>
            <td><code>{robot.team.hostname || PLACEHOLDER}</code></td>
            <td>{robot.updateRate.toFixed(2)} updates per second</td>
            <td>{robot.uids.join(', ') || PLACEHOLDER}</td>
            <td>
              <DeleteButton
                onClick={() => dispatch(disconnectTeam({ teamId: robot.teamId }))}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </HTMLTable>
  );
}
