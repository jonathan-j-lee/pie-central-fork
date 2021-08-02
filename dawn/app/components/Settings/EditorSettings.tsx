import * as React from 'react';
import { FormGroup, Icon } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { EditorTheme } from '../../store/settings';
import { NumericInput, Radio, Select, Switch } from './Forms';

const EDITOR_THEMES = [
  {
    id: EditorTheme.LIGHT,
    display: (
      <span>
        <Icon icon={IconNames.FLASH} /> Light theme
      </span>
    ),
  },
  {
    id: EditorTheme.DARK,
    display: (
      <span>
        <Icon icon={IconNames.MOON} /> Dark theme
      </span>
    ),
  },
];

const SYNTAX_THEMES = [
  { id: 'monokai', display: 'Monokai' },
  { id: 'github', display: 'GitHub' },
  { id: 'tomorrow', display: 'Tomorrow' },
  { id: 'kuroir', display: 'Kuroir' },
  { id: 'twilight', display: 'Twilight' },
  { id: 'xcode', display: 'XCode' },
  { id: 'textmate', display: 'TextMate' },
  { id: 'solarized_dark', display: 'Solarized Dark' },
  { id: 'solarized_light', display: 'Solarized Light' },
  { id: 'terminal', display: 'Terminal' },
];

const FILE_ENCODINGS = [
  { id: 'ascii', display: 'ASCII' },
  { id: 'utf8', display: 'UTF-8' },
  { id: 'utf16le', display: 'UTF-16 LE' },
  { id: 'latin1', display: 'Latin-1' },
];

export default function EditorSettings(props) {
  return (
    <>
      <FormGroup label="Editor Theme" helperText="The style of the UI elements.">
        <Radio options={EDITOR_THEMES} path="editor.editorTheme" />
      </FormGroup>
      <FormGroup
        label="Syntax Theme"
        helperText="The editor's syntax highlighting style."
      >
        <Select options={SYNTAX_THEMES} path="editor.syntaxTheme" />
      </FormGroup>
      <FormGroup
        label="Font Size"
        helperText={`
          The editor's font size.
          Use the 'View' menu in the toolbar to adjust the size of all UI elements.
        `}
      >
        <NumericInput
          path="editor.fontSize"
          leftIcon={IconNames.ZOOM_IN}
          min={10}
          max={64}
          majorStepSize={8}
        />
      </FormGroup>
      <FormGroup
        label="Tab Size"
        helperText={`
          The number of spaces each tab keypress should render as.
          By convention, standard Python code should use four spaces per indent.
        `}
      >
        <NumericInput
          path="editor.tabSize"
          leftIcon={IconNames.KEY_TAB}
          min={1}
          max={32}
          majorStepSize={4}
        />
      </FormGroup>
      <FormGroup
        label="File Encoding"
        helperText={`
          The encoding used to open and save files.
          We recommend using UTF-8, which is nearly universal on modern platforms.
        `}
      >
        <Select options={FILE_ENCODINGS} path="editor.encoding" />
      </FormGroup>
      <FormGroup label="Editor Features">
        <Switch label="Enable syntax highlighting" path="editor.syntaxHighlighting" />
        <Switch label="Show line numbers" path="editor.lineNumbers" />
        <Switch label="Show long line marker" path="editor.marginMarker" />
        <Switch label="Highlight current line" path="editor.highlightLine" />
        <Switch label="Wrap lines" path="editor.wrapLines" />
        <Switch label="Enable basic autocompletion" path="editor.basicAutocomplete" />
        <Switch label="Enable live autocompletion" path="editor.liveAutocomplete" />
        <Switch
          label="Ensure file ends with a newline character after saving"
          path="editor.appendNewline"
        />
        <Switch
          label="Remove trailing whitespace from each line after saving"
          path="editor.trimWhitespace"
        />
      </FormGroup>
    </>
  );
}
