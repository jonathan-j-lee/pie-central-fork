import * as React from 'react';
import { Button, Intent, Position, Toaster } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';

const toaster = Toaster.create({ position: Position.TOP_RIGHT });

export const reportOutcome = (promise, successMsg, errorMsg) =>
  promise
    .then(() => {
      toaster.show({
        intent: Intent.SUCCESS,
        message: successMsg,
        icon: IconNames.TICK,
      });
    })
    .catch(err => {
      toaster.show({
        intent: Intent.DANGER,
        message: errorMsg,
        icon: IconNames.ERROR,
      });
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
