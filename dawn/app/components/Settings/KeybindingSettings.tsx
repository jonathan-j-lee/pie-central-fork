import * as React from 'react';
import { HTMLTable } from '@blueprintjs/core';
import { EditableText } from './Forms';

export const COMMANDS = [
  {
    command: 'newFile',
    label: 'New file',
    group: 'File',
    success: 'Created a new file.',
    failure: 'Failed to create a new file.',
  },
  {
    command: 'openFile',
    label: 'Open file',
    group: 'File',
    success: 'Opened the selected file.',
    failure: 'Failed to open file.',
  },
  {
    command: 'saveFile',
    label: 'Save file',
    group: 'File',
    success: 'Saved the current file.',
    failure: 'Failed to save file.',
  },
  {
    command: 'saveFileAs',
    label: 'Save file as ...',
    group: 'File',
    success: 'Saved the file to the selected path.',
    failure: 'Failed to save file to the selected path.',
  },
  {
    command: 'downloadFile',
    label: 'Download',
    group: 'File',
    success: 'Downloaded code from the robot.',
    failure: 'Failed to download code from the robot.',
  },
  {
    command: 'uploadFile',
    label: 'Upload',
    group: 'File',
    success: 'Uploaded code to the robot.',
    failure: 'Failed to upload code to the robot.',
  },
  { command: 'cutText', label: 'Cut', group: 'Edit' },
  { command: 'copyText', label: 'Copy', group: 'Edit' },
  { command: 'pasteText', label: 'Paste', group: 'Edit' },
  {
    command: 'start',
    label: 'Start',
    group: 'Runtime',
    success: 'Started robot.',
    failure: 'Failed to start robot.',
  },
  {
    command: 'stop',
    label: 'Stop',
    group: 'Runtime',
    success: 'Stopped robot.',
    failure: 'Failed to stop robot.',
  },
  {
    command: 'estop',
    label: 'E-Stop',
    group: 'Runtime',
    success: 'Emergency-stopped robot.',
    failure: 'Failed to emergency-stop robot.',
  },
  { command: 'toggleConsole', label: 'Toggle', group: 'Console' },
  {
    command: 'copyConsole',
    label: 'Copy',
    group: 'Console',
    success: 'Copied console output.',
    failure: 'Failed to copy console output.',
  },
  { command: 'clearConsole', label: 'Clear', group: 'Console' },
  {
    command: 'lint',
    label: 'Lint',
    group: 'Debug',
    success: 'Linted current file.',
    failure: 'Failed to lint current file.',
  },
  {
    command: 'restart',
    label: 'Restart Runtime',
    group: 'Debug',
    success: 'Restarted Runtime.',
    failure: 'Failed to restart Runtime.',
  },
];

export default function KeybindingSettings(props) {
  return (
    <>
      <p>
        Each shortcut should be a list of keys separated by the <kbd>+</kbd> character.
        For example: <code>Ctrl+Shift+Alt+Backspace</code>.
      </p>
      <p>
        You can view your keyboard shortcuts by pressing <kbd>?</kbd>.
      </p>
      <HTMLTable striped className="keybindings">
        <thead>
          <tr>
            <th>Group</th>
            <th>Command</th>
            <th>Combination</th>
          </tr>
        </thead>
        <tbody>
          {COMMANDS.map(({ command, label, group }, index) => (
            <tr key={index}>
              <td>{group}</td>
              <td>{label}</td>
              <td>
                <EditableText
                  monospace
                  path={`keybindings.${command}.${props.platform ?? 'win'}`}
                  placeholder="Example: Ctrl+Shift+P"
                  validate={async (combo) => {
                    const parts = combo.replace(/\s/g, '').toLowerCase().split('+');
                    if (parts.some((part) => !part)) {
                      throw new Error('Invalid hotkey configuration.');
                    }
                    return combo;
                  }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </HTMLTable>
    </>
  );
}
