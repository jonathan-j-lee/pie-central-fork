import { useAppDispatch, useAppSelector } from '../hooks';
import editorSlice, { save } from '../store/editor';
import { Button, Classes, Dialog, Intent } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { Ace } from 'ace-builds/ace';
import * as React from 'react';

interface OverwriteDialogProps {
  editor?: Ace.Editor;
  transitionDuration?: number;
}

// TODO: select only necessary state
export default function OverwriteDialog(props: OverwriteDialogProps) {
  const dispatch = useAppDispatch();
  const prompt = useAppSelector((state) => state.editor.prompt);
  return (
    <Dialog
      isOpen={prompt}
      icon={IconNames.WARNING_SIGN}
      title="Unsaved Changes"
      transitionDuration={props.transitionDuration}
      onClose={() => dispatch(editorSlice.actions.cancel())}
    >
      <div className={Classes.DIALOG_BODY}>
        <p>
          You have unsaved changes on your current file. What would you like to do with
          these changes?
        </p>
      </div>
      <div className={Classes.DIALOG_FOOTER}>
        <div className={Classes.DIALOG_FOOTER_ACTIONS}>
          <Button
            intent={Intent.DANGER}
            icon={IconNames.TRASH}
            text="Discard"
            onClick={() => dispatch(editorSlice.actions.confirm())}
          />
          <Button
            intent={Intent.PRIMARY}
            icon={IconNames.IMPORT}
            text="Save"
            onClick={async () => {
              await dispatch(save({ editor: props.editor })).unwrap();
              dispatch(editorSlice.actions.confirm());
            }}
          />
        </div>
      </div>
    </Dialog>
  );
}
