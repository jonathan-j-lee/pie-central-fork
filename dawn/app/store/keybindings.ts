import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import * as _ from 'lodash';

export const selectCommand = (editor, group, commandId) => {
  const command = group.commands[commandId];
  return {
    text: command.label,
    label: (editor?.commands.platform === 'mac' ? command.mac : command.win)
      .replaceAll('+', ' + ')
      .replaceAll('-', ' - '),
    onClick: () => editor?.execCommand(commandId),
  };
};

export const generateHotkeys = (keybindings, editor) =>
  _.flatten(
    _.toPairs(keybindings)
      .map(([groupId, group]) => _.toPairs(group.commands)
        .map(([commandId, command]) => ({
          combo: editor?.commands.platform === 'mac' ? command.mac : command.win,
          label: command.label,
          group: group.group,
          groupId,
          commandId,
          global: true,
          onKeyDown: () => editor?.execCommand(commandId),
        }))
      )
  );

interface Keybinding {
  combo: string;
  groupId: string;
  commandId: string;
  platform: 'win' | 'mac';
};

export const bind = createAsyncThunk<Keybinding, Keybinding>(
  'keybindings/bind',
  async (binding, thunkAPI) => {
    const parts = binding.combo.replace(/\s/g, '').toLowerCase().split('+');
    if (parts.some(part => !part)) {
      throw new Error('invalid hotkey configuration');
    }
    return binding;
  },
);

export default createSlice({
  name: 'keybindings',
  initialState: {
    file: {
      group: 'File',
      commands: {
        newFile: { label: 'New file', win: 'Ctrl+N', mac: 'Cmd+N' },
        openFile: { label: 'Open file', win: 'Ctrl+O', mac: 'Cmd+O' },
        saveFile: { label: 'Save file', win: 'Ctrl+S', mac: 'Cmd+S' },
        saveFileAs: {
          label: 'Save file as ...',
          win: 'Ctrl+Shift+S',
          mac: 'Cmd+Shift+S',
        },
      },
    },
    edit: {
      group: 'Edit',
      commands: {
        cutText: { label: 'Cut', win: 'Ctrl+X', mac: 'Cmd+X' },
        copyText: { label: 'Copy', win: 'Ctrl+C', mac: 'Cmd+C' },
        pasteText: { label: 'Paste', win: 'Ctrl+V', mac: 'Cmd+V' },
      },
    },
    robot: {
      group: 'Robot',
      commands: {
        downloadFile: {
          label: 'Download',
          win: 'Ctrl+Shift+Enter',
          mac: 'Cmd+Shift+Enter',
        },
        uploadFile: {
          label: 'Upload',
          win: 'Ctrl+Enter',
          mac: 'Cmd+Enter',
        },
        start: { label: 'Start', win: 'Alt+1', mac: 'Alt+1' },
        stop: { label: 'Stop', win: 'Alt+2', mac: 'Alt+2' },
        estop: { label: 'E-Stop', win: 'Alt+3', mac: 'Alt+3' },
      },
    },
    log: {
      group: 'Console',
      commands: {
        toggleConsole: { label: 'Toggle', win: 'Ctrl+Shift+O', mac: 'Cmd+Shift+Q' },
        copyConsole: { label: 'Copy', win: 'Ctrl+Shift+C', mac: 'Cmd+Shift+C' },
        clearConsole: { label: 'Clear', win: 'Ctrl+Shift+X', mac: 'Cmd+Shift+X' },
      },
    },
    debug: {
      group: 'Debug',
      commands: {
        lint: { label: 'Lint', win: 'Alt+L', mac: 'Alt+L' },
        restart: { label: 'Restart Runtime', win: 'Alt+R', mac: 'Alt+R' },
      },
    },
  },
  reducers: {
  },
  extraReducers: (builder) => {
    builder
      .addCase(bind.fulfilled, (state, action) => {
        const { groupId, commandId, platform, combo } = action.payload;
        const group = state[groupId];
        if (group) {
          const command = group.commands[commandId];
          if (command) {
            command[platform ?? 'win'] = combo;
          }
        }
      });
  },
});
