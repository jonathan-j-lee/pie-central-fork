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
    .catch((err) => {
      if (failure) {
        toaster.show({
          intent: Intent.DANGER,
          message: failure,
          icon: IconNames.ERROR,
        });
      }
    });

export const OutcomeButton = (props) => {
  const [loading, setLoading] = React.useState(false);
  const onClick = props.onClick;
  const btnProps = {
    ...props,
    loading,
    onClick: event => {
      setLoading(true);
      onClick(event).finally(() => setLoading(false));
    },
  };
  return (<Button {...btnProps} />);
};

export const DeviceName = (props) => <EditableText
  alwaysRenderInput
  placeholder="Assign a name"
  maxLength={32}
  {...props}
/>;
