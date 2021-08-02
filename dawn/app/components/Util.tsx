import * as React from 'react';
import { Button, EditableText, Intent, Position, Toaster } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';

const toaster = Toaster.create({ position: Position.TOP_RIGHT });

export const notify = (promise, success, failure) =>
  promise
    .then(() => {
      if (success) {
        toaster.show({
          intent: Intent.SUCCESS,
          message: success,
          icon: IconNames.TICK,
        });
      }
    })
    .catch(() => {
      if (failure) {
        toaster.show({
          intent: Intent.DANGER,
          message: failure,
          icon: IconNames.ERROR,
        });
      }
    });

type ClickCallback = (event: React.MouseEvent<HTMLButtonElement>) => Promise<void>;

export const OutcomeButton = (props: { onClick: ClickCallback }) => {
  const [loading, setLoading] = React.useState(false);
  const extra = {
    loading,
    onClick: (event) => {
      setLoading(true);
      props.onClick(event).finally(() => setLoading(false));
    },
  };
  return <Button {...props} {...extra} />;
};

export const DeviceName = (props) => (
  <EditableText
    alwaysRenderInput
    placeholder="Assign a name"
    maxLength={32}
    {...props}
  />
);
