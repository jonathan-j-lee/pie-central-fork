import * as React from 'react';
import AceEditor from 'react-ace';
import { Classes, Tooltip } from '@blueprintjs/core';
import * as _ from 'lodash';
import { useAppSelector, useAppDispatch } from '../hooks';
import { initializeSettings, exportSettings } from '../store';
import editorSlice, {
  create,
  open,
  save,
} from '../store/editor';
import { addCommands, reportOutcome } from './Util';

import 'ace-builds/src-noconflict/mode-python';
import 'ace-builds/src-noconflict/ext-language_tools';  // For autocompletion
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

// TODO: pull API from robot and add symbols to autocomplete. Create help page.
// TODO: convert to async/await syntax
export default function Editor(props) {
  const editor = props.editorRef.current?.editor;
  const dispatch = useAppDispatch();
  const editorState = useAppSelector(state => state.editor);
  const keybindings = useAppSelector(state => _.pick(state.keybindings, ['file', 'edit']));
  const saveFile = (filePath) => reportOutcome(
    dispatch(save({ filePath, editor }))
      .unwrap()
      .then(() => dispatch(exportSettings()).unwrap()),
    'Saved the current file.',
    'Failed to save the current file.',
  );
  React.useEffect(() => {
    if (editor) {
      ace.config.loadModule('ace/ext/keybinding_menu', (module) => {
        module.init(editor);
      });
    }
  }, [editor]);
  React.useEffect(() => {
    /* Delay slightly so the main process can register a 'save-settings' handler. */
    const timeout = setTimeout(() => dispatch(initializeSettings({ editor })), 100);
    return () => clearTimeout(timeout);
  }, []);
  React.useEffect(() => addCommands(editor?.commands, [
    {
      name: 'newFile',
      group: 'File',
      bindKey: keybindings.file.commands.newFile,
      exec: () => reportOutcome(
        dispatch(create({ editor }))
          .unwrap()
          .then(() => dispatch(exportSettings()).unwrap()),
        'Created a new file.',
        'Failed to create a new file.',
      ),
    },
    {
      name: 'openFile',
      group: 'File',
      bindKey: keybindings.file.commands.openFile,
      exec: () => reportOutcome(
        dispatch(open({ editor }))
          .unwrap()
          .then(() => dispatch(exportSettings()).unwrap()),
        'Opened the selected file.',
        'Failed to open the selected file.',
      ),
    },
    {
      name: 'saveFile',
      group: 'File',
      bindKey: keybindings.file.commands.saveFile,
      exec: (editor) => saveFile(editorState.filePath),
    },
    {
      name: 'saveFileAs',
      group: 'File',
      bindKey: keybindings.file.commands.saveFileAs,
      exec: (editor) => saveFile(null),
    },
    {
      name: 'cutText',
      group: 'Edit',
      bindKey: keybindings.edit.commands.cutText,
      exec: (editor) => navigator.clipboard.writeText(editor.getCopyText())
        .then(() => editor.execCommand('cut')),
    },
    {
      name: 'copyText',
      group: 'Edit',
      bindKey: keybindings.edit.commands.copyText,
      exec: (editor) => navigator.clipboard.writeText(editor.getCopyText()),
    },
    {
      name: 'pasteText',
      group: 'Edit',
      bindKey: keybindings.edit.commands.pasteText,
      exec: (editor) => navigator.clipboard.readText()
        .then((text) => editor.session.insert(editor.getCursorPosition(), text)),
    },
  ]), [dispatch, editorState.filePath, keybindings]);
  const [cursor, setCursor] = React.useState({ row: 0, column: 0 });
  const [range, setRange] = React.useState({ rows: 1, chars: 0 });
  return (
    <>
      <AceEditor
        ref={props.editorRef}
        mode={editorState.syntaxHighlighting ? 'python' : null}
        theme={editorState.syntaxTheme}
        width='100%'
        height='100%'
        showGutter={editorState.lineNumbers}
        showPrintMargin={editorState.longLineMarker}
        highlightActiveLine={editorState.highlightLine}
        wrapEnabled={editorState.wrapLines}
        enableBasicAutocompletion={editorState.basicAutocompletion}
        enableLiveAutocompletion={editorState.liveAutocompletion}
        fontSize={editorState.fontSize}
        tabSize={editorState.tabSize}
        onChange={() => {
          if (!editorState.dirty) {
            dispatch(editorSlice.actions.setDirty());
          }
        }}
        onCursorChange={selection => setCursor(selection.getCursor())}
        onSelectionChange={selection => {
          const { start, end } = selection.getRange();
          const text = editor?.getSelectedText() ?? '';
          setRange({ rows: 1 + end.row - start.row, chars: text.length });
        }}
        annotations={editorState.annotations}
      />
      <div className="editor-status">
        <Tooltip
          className={Classes.TOOLTIP_INDICATOR}
          content={<p className="tooltip-content">
            The file you are editing has {editorState.dirty ? '' : 'no'} unsaved changes.
            {!editorState.filePath ? ' This file has not yet been saved.' : ''}
          </p>}
        >
          <code>
            {editorState.filePath || '(Unsaved File)'}
            {editorState.dirty ? '*' : ''}
          </code>
        </Tooltip>
        <div className="cursor-status">
          <Tooltip
            className={`cursor-status-tooltip ${Classes.TOOLTIP_INDICATOR}`}
            content={<p className="tooltip-content">
              Cursor is at line {cursor.row + 1}, column {cursor.column + 1}.
            </p>}
          >
            <code>{cursor.row + 1}:{cursor.column + 1}</code>
          </Tooltip>
          {range.chars > 0 &&
            <Tooltip
              className={`cursor-status-tooltip ${Classes.TOOLTIP_INDICATOR}`}
              content={<p className="tooltip-content">
                Selected text spans {range.rows} lines and {range.chars} characters.
              </p>}
            >
              <code>({range.rows}, {range.chars})</code>
            </Tooltip>}
        </div>
      </div>
    </>
  );
};
