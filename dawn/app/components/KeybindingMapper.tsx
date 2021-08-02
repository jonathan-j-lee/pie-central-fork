import * as React from 'react';
import { useHotkeys } from '@blueprintjs/core';
import { Editor } from 'ace-builds/src-min/ace';
import { useAppDispatch, useAppSelector } from '../hooks';
import { create, open, save, lint } from '../store/editor';
import logSlice, { copy } from '../store/log';
import { changeMode, upload, download, restart, Mode } from '../store/runtime';
import { save as saveSettings } from '../store/settings';
import { COMMANDS } from './Settings/KeybindingSettings';
import { notify } from './Util';

interface KeybindingMapperProps {
  mode: Mode;
  editor?: Editor;
  children: React.ReactNode;
}

export default function KeybindingMapper(props: KeybindingMapperProps) {
  const dispatch = useAppDispatch();
  const keybindings = useAppSelector((state) => state.settings.keybindings);
  // TODO: don't write settings if the file path does not change.
  const commandHandlers = React.useMemo(
    () => ({
      async newFile(editor) {
        await dispatch(create({ editor })).unwrap();
        await dispatch(saveSettings()).unwrap();
      },
      async openFile(editor) {
        await dispatch(open({ editor })).unwrap();
        await dispatch(saveSettings()).unwrap();
      },
      async saveFile(editor) {
        await dispatch(save({ editor })).unwrap();
        await dispatch(saveSettings()).unwrap();
      },
      async saveFileAs(editor) {
        await dispatch(save({ editor, forcePrompt: true })).unwrap();
        await dispatch(saveSettings()).unwrap();
      },
      async downloadFile(editor) {
        await dispatch(download({ editor })).unwrap();
      },
      async uploadFile(editor) {
        await dispatch(upload({ editor })).unwrap();
      },
      async cutText(editor) {
        await navigator.clipboard.writeText(editor.getCopyText());
        editor.execCommand('cut');
      },
      async copyText(editor) {
        await navigator.clipboard.writeText(editor.getCopyText());
      },
      async pasteText(editor) {
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
      async lint(editor) {
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
      const commands = COMMANDS.map(({ command, success, failure }) => ({
        name: command,
        bindKey: keybindings[command],
        exec: (editor) => notify(commandHandlers[command](editor), success, failure),
      }));
      commands.forEach((command) => commandManager.addCommand(command));
      return () => {
        commands.forEach((command) => commandManager.removeCommand(command));
      };
    }
  }, [props.editor, commandHandlers, keybindings]);

  const hotkeys = React.useMemo(() => {
    const platform = props.editor?.commands.platform;
    return COMMANDS.map((command) => ({
      ...command,
      combo: (keybindings[command.command] ?? {})[platform],
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
