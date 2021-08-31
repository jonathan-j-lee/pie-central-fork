import * as React from 'react';
import { Alert, Button, Intent, IButtonProps } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { Team, displayTeam } from '../../types';

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

interface AlertButtonProps extends IButtonProps {
  getWarnings: () => string[];
}

export function AlertButton({ getWarnings, ...props }: AlertButtonProps) {
  const [event, setEvent] = React.useState<React.MouseEvent<HTMLElement> | null>(null);
  const [warnings, setWarnings] = React.useState<string[]>([]);
  return (
    <>
      <Alert
        canEscapeKeyCancel
        canOutsideClickCancel
        isOpen={warnings.length > 0}
        icon={IconNames.WARNING_SIGN}
        intent={Intent.DANGER}
        cancelButtonText="Cancel"
        confirmButtonText="Confirm"
        onConfirm={() => {
          if (event) {
            props.onClick?.(event);
          }
        }}
        onClose={() => {
          setEvent(null);
          setWarnings([]);
        }}
      >
        {warnings.map((warning, index) => (
          <p key={index}>{warning}</p>
        ))}
      </Alert>
      <Button
        {...props}
        onClick={(event) => {
          const warnings = getWarnings();
          if (warnings.length > 0) {
            setEvent(event);
            setWarnings(warnings);
          } else {
            props.onClick?.(event);
          }
        }}
      />
    </>
  );
}
