import * as React from 'react';
import { Alert, Button, Intent } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';

interface HelpProps {
  transitionDuration?: number;
  children?: React.ReactNode;
}

export default function Help(props: HelpProps) {
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
        transitionDuration={props.transitionDuration}
      >
        {props.children}
      </Alert>
      <Button icon={IconNames.HELP} text="Help" onClick={() => setShow(!show)} />
    </>
  );
}
