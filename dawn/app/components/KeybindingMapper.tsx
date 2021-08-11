import * as React from 'react';
import { useHotkeys } from '@blueprintjs/core';
import { Ace } from 'ace-builds/ace';
import { useAppDispatch, useAppSelector } from '../hooks';
import { create, open, save, lint } from '../store/editor';
import logSlice, { copy } from '../store/log';
import { changeMode, upload, download, restart, Mode } from '../store/runtime';
import { save as saveSettings } from '../store/settings';
import { COMMANDS } from './Settings/KeybindingSettings';
import { notify } from './Util';

interface KeybindingMapperProps {
  mode: Mode;
  editor?: Ace.Editor;
  children: React.ReactNode;
  platform: 'win' | 'mac';
}

interface CommandHandlers {
  [command: string]: (editor: Ace.Editor) => any;
}

export default function KeybindingMapper(props: KeybindingMapperProps) {
  const dispatch = useAppDispatch();
  const keybindings = useAppSelector((state) => state.settings.keybindings);
  // TODO: don't write settings if the file path does not change.
  const commandHandlers: CommandHandlers = React.useMemo(
    () => ({
      async newFile(editor: Ace.Editor) {
        await dispatch(create({ editor })).unwrap();
        await dispatch(saveSettings()).unwrap();
      },
      async openFile(editor: Ace.Editor) {
        await dispatch(open({ editor })).unwrap();
        await dispatch(saveSettings()).unwrap();
      },
      async saveFile(editor: Ace.Editor) {
        await dispatch(save({ editor })).unwrap();
        await dispatch(saveSettings()).unwrap();
      },
      async saveFileAs(editor: Ace.Editor) {
        await dispatch(save({ editor, forcePrompt: true })).unwrap();
        await dispatch(saveSettings()).unwrap();
      },
      async downloadFile(editor: Ace.Editor) {
        await dispatch(download({ editor })).unwrap();
      },
      async uploadFile(editor: Ace.Editor) {
        await dispatch(upload({ editor })).unwrap();
      },
      async cutText(editor: Ace.Editor) {
        await navigator.clipboard.writeText(editor.getCopyText());
        editor.execCommand('cut');
      },
      async copyText(editor: Ace.Editor) {
        await navigator.clipboard.writeText(editor.getCopyText());
      },
      async pasteText(editor: Ace.Editor) {
        editor.insert(await navigator.clipboard.readText());
      },
      async start() {
        await dispatch(changeMode(props.mode)).unwrap();
      },
      async stop() {
        await dispatch(changeMode(Mode.IDLE)).unwrap();
      },
      async estop() {
        await dispatch(changeMode(Mode.ESTOP)).unwrap();
      },
      async toggleConsole() {
        dispatch(logSlice.actions.toggleOpen());
      },
      async copyConsole() {
        await dispatch(copy()).unwrap();
      },
      async clearConsole() {
        dispatch(logSlice.actions.clear());
      },
      async lint(editor: Ace.Editor) {
        await dispatch(upload({ editor })).unwrap();
        await dispatch(lint()).unwrap();
      },
      async restart() {
        await dispatch(restart()).unwrap();
      },
    }),
    [dispatch, props.mode]
  );

  React.useEffect(() => {
    const commandManager = props.editor?.commands;
    if (commandManager) {
      const commands = COMMANDS.map(({ command: name, success, failure }) => ({
        name,
        bindKey: keybindings[name],
        exec: (editor: Ace.Editor) => {
          const command = commandHandlers[name];
          notify(command ? command(editor) : Promise.reject(), success, failure);
        },
      }));
      commands.forEach((command) => commandManager.addCommand(command));
      return () => {
        commands.forEach((command) => commandManager.removeCommand(command));
      };
    }
  }, [props.editor, commandHandlers, keybindings]);

  const hotkeys = React.useMemo(() => {
    return COMMANDS.map((command) => ({
      ...command,
      combo: (keybindings[command.command] ?? {})[props.platform],
    }))
      .filter(({ combo }) => combo)
      .map(({ combo, command, group, label }) => ({
        combo: combo.toLowerCase(),
        label,
        group,
        onKeyDown: () => props.editor?.execCommand(command),
      }));
  }, [props.editor, keybindings]);
  const { handleKeyDown, handleKeyUp } = useHotkeys(hotkeys);
  /* Blueprint uses a deprecated property that we have to set here:
       https://github.com/palantir/blueprint/issues/4165 */
  return (
    <div
      onKeyDown={(event) => {
        Object.defineProperty(event.nativeEvent, 'which', { value: event.which });
        return handleKeyDown(event);
      }}
      onKeyUp={(event) => {
        Object.defineProperty(event.nativeEvent, 'which', { value: event.which });
        return handleKeyUp(event);
      }}
    >
      {props.children}
    </div>
  );
}
