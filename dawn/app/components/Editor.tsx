import * as React from 'react';
import AceEditor from 'react-ace';

class Editor extends React.Component {
  render() {
    return (
      <div className="editor">
        <AceEditor
          mode="python"
          theme="monokai"
          width="100%"
          height="100%"
        />
      </div>
    );
  }
}

export default Editor;
