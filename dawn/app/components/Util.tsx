import * as React from 'react';
import { Button, Intent, Toaster } from '@blueprintjs/core';

const toaster = Toaster.create();

export const reportOutcome = (promise, successMsg, errorMsg) =>
  promise
    .then(() => {
      toaster.show({
        intent: Intent.SUCCESS,
        message: successMsg,
      });
    })
    .catch(err => {
      toaster.show({
        intent: Intent.DANGER,
        message: errorMsg,
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
