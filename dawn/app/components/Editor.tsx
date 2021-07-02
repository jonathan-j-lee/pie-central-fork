import * as React from 'react';
import AceEditor from 'react-ace';
import { Classes, Tooltip } from '@blueprintjs/core';
import { useAppSelector, useAppDispatch } from '../hooks';
import editor from '../store/editor';

import 'ace-builds/src-noconflict/mode-python';
import 'ace-builds/src-noconflict/ext-language_tools';  // For autocompletion
import 'ace-builds/src-noconflict/ext-searchbox';

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

export default function Editor(props) {
  const dispatch = useAppDispatch();
  const editorState = useAppSelector(state => state.editor);
  const [cursor, setCursor] = React.useState({ row: 0, column: 0 });
  const [range, setRange] = React.useState({ rows: 1, chars: 0 });
  return (
    <div className="editor">
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
        onChange={() => dispatch(editor.actions.setDirty())}
        onCursorChange={selection => setCursor(selection.getCursor())}
        onSelectionChange={selection => {
          const { start, end } = selection.getRange();
          const text = props.editorRef.current.editor.getSelectedText();
          setRange({ rows: 1 + end.row - start.row, chars: text.length });
        }}
        annotations={[]}
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
            <code>
              {cursor.row + 1}:{cursor.column + 1}
            </code>
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
    </div>
  );
};
