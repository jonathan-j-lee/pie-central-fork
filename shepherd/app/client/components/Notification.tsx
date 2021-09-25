import * as React from 'react';
import {
  Alert,
  Button,
  IButtonProps,
  Intent,
  Position,
  Toaster,
} from '@blueprintjs/core';
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

function useAsyncCallback(
  callback: () => Promise<void>,
  success?: string,
  failure?: string,
): [boolean, () => Promise<void>] {
  const [loading, setLoading] = React.useState(false);
  const execute = React.useCallback(async () => {
    setLoading(true);
    try {
      await callback();
      if (success) {
        notifySuccess(success);
      }
    } catch {
      if (failure) {
        notifyFailure(failure);
      }
    } finally {
      setLoading(false);
    }
  }, [callback, success, failure, setLoading]);
  return [loading, execute];
}

export interface OutcomeButtonProps extends IButtonProps {
  onClick: () => Promise<void>;
  success?: string;
  failure?: string;
}

export function OutcomeButton(props: OutcomeButtonProps) {
  const [loading, onClick] = useAsyncCallback(
    props.onClick,
    props.success,
    props.failure,
  );
  return <Button {...props} loading={loading} onClick={onClick} />;
}

export interface AlertButtonProps extends OutcomeButtonProps {
  getWarnings: () => string[];
}

export function AlertButton({ getWarnings, ...props }: AlertButtonProps) {
  const [loading, onClick] = useAsyncCallback(
    props.onClick,
    props.success,
    props.failure,
  );
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
        loading={loading}
        onConfirm={onClick}
        onClose={() => setWarnings([])}
      >
        {warnings.map((warning, index) => <p key={index}>{warning}</p>)}
      </Alert>
      <Button
        {...props}
        loading={loading}
        onClick={async () => {
          const warnings = getWarnings();
          if (warnings.length > 0) {
            setWarnings(warnings);
          } else {
            await onClick();
          }
        }}
      />
    </>
  );
}
