import * as React from 'react';
import { Button, EditableText, Intent, Position, Toaster } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';

const toaster = Toaster.create({ position: Position.TOP_RIGHT });

export const platform = /mac/i.test(navigator.platform) ? 'mac' : 'win';

export const notify = (promise: Promise<any>, success?: string, failure?: string) =>
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

type ClickCallback = (event: React.MouseEvent<HTMLElement>) => Promise<void>;

export const OutcomeButton = (props: { onClick: ClickCallback }) => {
  const [loading, setLoading] = React.useState(false);
  return (
    <Button
      {...props}
      loading={loading}
      onClick={(event) => {
        setLoading(true);
        props.onClick(event).finally(() => setLoading(false));
      }}
    />
  );
};
