import * as React from 'react';
import { Button, Classes, Dialog, Intent } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useAppDispatch, useAppSelector } from '../hooks';
import editorSlice, { save } from '../store/editor';

// TODO: select only necessary state
export default function OverwriteDialog(props) {
  const dispatch = useAppDispatch();
  const prompt = useAppSelector((state) => state.editor.prompt);
  return (
    <Dialog
      isOpen={prompt}
      icon={IconNames.WARNING_SIGN}
      title="Unsaved Changes"
      transitionDuration={100}
      onClose={() => dispatch(editorSlice.actions.cancel())}
    >
      <div className={Classes.DIALOG_BODY}>
        <p>
          You have unsaved changes on your current file.
          What would you like to do with these changes?
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
            onClick={() =>
              dispatch(save({ editor: props.editor }))
                .unwrap()
                .then(() => dispatch(editorSlice.actions.confirm()))
            }
          />
        </div>
      </div>
    </Dialog>
  );
};
