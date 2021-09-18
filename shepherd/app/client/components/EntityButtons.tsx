import * as React from 'react';
import { Button, IButtonProps, Intent } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { OutcomeButton, OutcomeButtonProps } from './Notification';

export function AddButton(props: IButtonProps) {
  return <Button intent={Intent.PRIMARY} icon={IconNames.ADD} {...props} />;
}

export function ConfirmButton(props: OutcomeButtonProps) {
  return (
    <OutcomeButton
      text="Confirm"
      intent={Intent.SUCCESS}
      icon={IconNames.TICK}
      {...props}
    />
  );
}

export function DeleteButton(props: IButtonProps) {
  return <Button minimal icon={IconNames.CROSS} intent={Intent.DANGER} {...props} />;
}

interface EditButtonProps {
  edit: boolean;
  setEdit: (edit: boolean) => void;
}

export function EditButton({
  edit,
  setEdit,
  ...props
}: IButtonProps & EditButtonProps) {
  return (
    <Button
      text={edit ? 'View' : 'Edit'}
      icon={edit ? IconNames.EYE_OPEN : IconNames.EDIT}
      onClick={() => setEdit(!edit)}
      {...props}
    />
  );
}
