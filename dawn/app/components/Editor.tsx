import * as React from 'react';
import AceEditor from 'react-ace';
import { Classes, Tooltip } from '@blueprintjs/core';
import { useAppSelector, useAppDispatch } from '../hooks';
import { initializeSettings } from '../store';
import editorSlice from '../store/editor';

import { Editor as EditorBackend } from 'ace-builds/src-min/ace';
import ace from 'ace-builds/src-noconflict/ace';
import 'ace-builds/src-noconflict/mode-python';
import 'ace-builds/src-noconflict/ext-language_tools'; // For autocompletion
import 'ace-builds/src-noconflict/ext-searchbox';
import 'ace-builds/src-noconflict/ext-keybinding_menu';
import 'ace-builds/src-noconflict/ext-settings_menu';

import 'ace-builds/src-noconflict/theme-monokai';
import 'ace-builds/src-noconflict/theme-github';
import 'ace-builds/src-noconflict/theme-tomorrow';
import 'ace-builds/src-noconflict/theme-kuroir';
import 'ace-builds/src-noconflict/theme-twilight';
import 'ace-builds/src-noconflict/theme-xcode';
import 'ace-builds/src-noconflict/theme-textmate';
import 'ace-builds/src-noconflict/theme-solarized_dark';
import 'ace-builds/src-noconflict/theme-solarized_light';
import 'ace-builds/src-noconflict/theme-terminal';

const INITIALIZE_DELAY = 100;

interface EditorStatusProps {
  filePath: null | string;
  dirty: boolean;
  range: {
    chars: number;
    rows: number;
  };
  cursor: {
    row: number;
    column: number;
  };
}

const EditorStatus = (props: EditorStatusProps) => (
  <div className="editor-status">
    <Tooltip
      className={Classes.TOOLTIP_INDICATOR}
      content={
        <p className="tooltip-content">
          The file you are editing has {props.dirty ? '' : 'no'} unsaved changes.
          {!props.filePath ? ' This file has not yet been saved.' : ''}
        </p>
      }
    >
      <code>
        {props.filePath ?? '(Unsaved File)'}
        {props.dirty ? '*' : ''}
      </code>
    </Tooltip>
    {props.range.chars > 0 && (
      <Tooltip
        className={`cursor-status-tooltip ${Classes.TOOLTIP_INDICATOR}`}
        content={
          <p className="tooltip-content">
            Selected text spans {props.range.rows} lines and {props.range.chars}{' '}
            characters.
          </p>
        }
      >
        <code>
          ({props.range.rows}, {props.range.chars})
        </code>
      </Tooltip>
    )}
    <Tooltip
      className={`cursor-status-tooltip ${Classes.TOOLTIP_INDICATOR}`}
      content={
        <p className="tooltip-content">
          Cursor is at line {props.cursor.row + 1}, column {props.cursor.column + 1}.
        </p>
      }
    >
      <code>
        {props.cursor.row + 1}:{props.cursor.column + 1}
      </code>
    </Tooltip>
  </div>
);

interface EditorProps {
  editor?: EditorBackend;
  setEditor: (EditorBackend) => void;
}

// TODO: pull API from robot and add symbols to autocomplete. Create help page.
// TODO: convert to async/await syntax
export default function Editor(props: EditorProps) {
  const dispatch = useAppDispatch();
  const { dirty, filePath, annotations } = useAppSelector((state) => state.editor);
  const settings = useAppSelector((state) => state.settings.editor);
  React.useEffect(() => {
    /* Delay slightly so the main process can register a 'save-settings' handler. */
    const initialize = () => dispatch(initializeSettings({ editor: props.editor }));
    const timeoutId = setTimeout(initialize, INITIALIZE_DELAY);
    return () => clearTimeout(timeoutId);
  }, []);
  const [cursor, setCursor] = React.useState({ row: 0, column: 0 });
  const [range, setRange] = React.useState({ rows: 1, chars: 0 });
  return (
    <>
      <AceEditor
        ref={(node) => {
          const editor = node?.editor;
          if (editor) {
            ace.config.loadModule('ace/ext/keybinding_menu', (module) => {
              module.init(editor);
            });
          }
          props.setEditor(editor);
        }}
        mode={settings.syntaxHighlighting ? 'python' : null}
        theme={settings.syntaxTheme}
        width="100%"
        height="100%"
        showGutter={settings.lineNumbers}
        showPrintMargin={settings.marginMarker}
        highlightActiveLine={settings.highlightLine}
        wrapEnabled={settings.wrapLines}
        enableBasicAutocompletion={settings.basicAutocomplete}
        enableLiveAutocompletion={settings.liveAutocomplete}
        fontSize={settings.fontSize}
        tabSize={settings.tabSize}
        onChange={() => {
          if (!dirty) {
            dispatch(editorSlice.actions.setDirty());
          }
        }}
        onCursorChange={(selection) => setCursor(selection.getCursor())}
        onSelectionChange={(selection) => {
          const { start, end } = selection.getRange();
          const text = props.editor?.getSelectedText() ?? '';
          setRange({ rows: 1 + end.row - start.row, chars: text.length });
        }}
        annotations={annotations}
      />
      <EditorStatus cursor={cursor} range={range} dirty={dirty} filePath={filePath} />
    </>
  );
}
