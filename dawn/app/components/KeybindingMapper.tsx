import * as React from 'react';
import { useHotkeys } from '@blueprintjs/core';
import { useAppDispatch, useAppSelector } from '../hooks';
import { create, open, save, lint } from '../store/editor';
import logSlice, { copy } from '../store/log';
import { changeMode, upload, download, restart, Mode } from '../store/robot';
import { save as saveSettings } from '../store/settings';
import { COMMANDS } from './Settings/KeybindingSettings';
import { notify } from './Util';

export default function KeybindingMapper(props) {
  const dispatch = useAppDispatch();
  const keybindings = useAppSelector((state) => state.settings.keybindings);
  const commandHandlers = React.useMemo(() => ({
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
      const text = await navigator.clipboard.readText();
      editor.session.insert(editor.getCursorPosition(), text);
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
  }), [dispatch, props.mode]);

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
    return COMMANDS
      .map((command) => ({
        ...command,
        combo: (keybindings[command.command] ?? {})[platform],
      }))
      .filter(({ combo }) => combo)
      .map(({ combo, command, group, label }) => ({
        combo,
        label,
        group,
        global: true,
        onKeyDown: () => props.editor?.execCommand(command),
      }));
  }, [props.editor, keybindings]);
  const { handleKeyDown, handleKeyUp } = useHotkeys(hotkeys);
  return <div onKeyDown={handleKeyDown} onKeyUp={handleKeyUp}>{props.children}</div>;
}
