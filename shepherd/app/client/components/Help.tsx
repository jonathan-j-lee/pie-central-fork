import * as React from 'react';
import { Alert, Button, Intent } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';

export default function Help(props: { children: React.ReactNode }) {
  const [show, setShow] = React.useState(false);
  return (
    <>
      <Alert
        canEscapeKeyCancel
        canOutsideClickCancel
        intent={Intent.PRIMARY}
        icon={IconNames.INFO_SIGN}
        isOpen={show}
        onClose={() => setShow(false)}
        className="help-dialog"
      >
        {props.children}
      </Alert>
      <Button icon={IconNames.HELP} text="Help" onClick={() => setShow(!show)} />
    </>
  );
}
