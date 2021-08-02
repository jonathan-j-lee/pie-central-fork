import * as React from 'react';
import { useStore } from 'react-redux';
import { Button, Classes, Dialog, Intent, Tab, Tabs } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import * as _ from 'lodash';

import { useAppDispatch } from '../../hooks';
import settingsSlice, { save } from '../../store/settings';
import EditorSettings from './EditorSettings';
import KeybindingSettings from './KeybindingSettings';
import LogSettings from './LogSettings';
import RuntimeSettings from './RuntimeSettings';
import { notify } from '../Util';

// TODO: text/UI size
export default function Settings(props) {
  const store = useStore();
  const dispatch = useAppDispatch();
  const [prevSettings, setPrevSettings] = React.useState({});
  // TODO: loading indicator (state) for save
  const revert = () => {
    dispatch(settingsSlice.actions.update({ value: prevSettings }));
    props.close();
  };
  return (
    <Dialog
      isOpen={props.isOpen}
      onOpened={() => setPrevSettings(store.getState().settings)}
      onClose={revert}
      onClosed={() => setPrevSettings({})}
      title="Settings"
      className="settings"
    >
      <div className={Classes.DIALOG_BODY}>
        <Tabs defaultSelectedTabId="runtime" large>
          <Tab id="runtime" title="Runtime" panel={<RuntimeSettings />} />
          <Tab id="editor" title="Editor" panel={<EditorSettings />} />
          <Tab id="log" title="Console" panel={<LogSettings />} />
          <Tab
            id="keybindings"
            title="Keybindings"
            panel={<KeybindingSettings platform={props.platform} />}
          />
        </Tabs>
      </div>
      <div className={Classes.DIALOG_FOOTER}>
        <div className={Classes.DIALOG_FOOTER_ACTIONS}>
          <Button
            icon={IconNames.RESET}
            text="Reset defaults"
            intent={Intent.DANGER}
            onClick={revert}
          />
          <Button icon={IconNames.CROSS} text="Cancel" onClick={revert} />
          <Button
            icon={IconNames.CONFIRM}
            text="Confirm"
            intent={Intent.SUCCESS}
            onClick={() =>
              notify(
                dispatch(save()).finally(() => props.close()),
                'Saved settings.',
                'Failed to save settings.'
              )
            }
          />
        </div>
      </div>
    </Dialog>
  );
}
