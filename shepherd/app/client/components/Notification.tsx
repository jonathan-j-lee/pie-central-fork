import * as React from 'react';
import { IButtonProps, Button, Intent, Position, Toaster } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';

const toaster = Toaster.create({ position: Position.TOP });

export const notifySuccess = (message: string) =>
  toaster.show({
    intent: Intent.SUCCESS,
    icon: IconNames.TICK,
    message,
  });

export const notifyFailure = (message: string) =>
  toaster.show({
    intent: Intent.DANGER,
    icon: IconNames.ERROR,
    message,
  });

export async function notify(
  promise: Promise<any>,
  success?: string,
  failure?: string
) {
  try {
    await promise;
    if (success) {
      notifySuccess(success);
    }
  } catch {
    if (failure) {
      notifyFailure(failure);
    }
  }
}

interface OutcomeButtonProps extends IButtonProps {
  onClick: (event: React.MouseEvent<HTMLElement>) => Promise<void>;
}

export const OutcomeButton = (props: OutcomeButtonProps) => {
  const [loading, setLoading] = React.useState(false);
  return (
    <Button
      {...props}
      loading={loading}
      onClick={async (event) => {
        setLoading(true);
        try {
          await props.onClick(event);
        } finally {
          setLoading(false);
        }
      }}
    />
  );
};
