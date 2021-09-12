import * as React from 'react';
import {
  Button,
  ControlGroup,
  FormGroup,
  Intent,
  InputGroup,
} from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { AllianceColorSelect, TeamSelect } from '../EntitySelects';
import { useAppDispatch, useCurrentMatch } from '../../hooks';
import { connectTeam } from '../../store/control';
import { AllianceColor } from '../../../types';

export default function TeamAdder() {
  const dispatch = useAppDispatch();
  const match = useCurrentMatch();
  const [alliance, setAlliance] = React.useState(AllianceColor.NONE);
  const [teamId, setTeamId] = React.useState<number | null>(null);
  const [hostname, setHostname] = React.useState('');
  return (
    <FormGroup
      label="Add teams"
      helperText="Assign a team to an alliance. Optionally, you may change the hostname of a team's robot."
    >
      <ControlGroup>
        <AllianceColorSelect
          disabled={!match}
          value={alliance}
          setValue={setAlliance}
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
          onClick={() =>
            teamId && dispatch(connectTeam({ alliance, teamId, hostname }))
          }
        />
      </ControlGroup>
    </FormGroup>
  );
}
