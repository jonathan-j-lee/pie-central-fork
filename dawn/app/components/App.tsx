import * as React from 'react';

import Console from './Console';
import Editor from './Editor';
import PeripheralList from './PeripheralList';
import Toolbar from './Toolbar';


class App extends React.PureComponent {
  render() {
    return (
      <div id="app">
        <Toolbar />
        <main>
          <Editor />
          <PeripheralList />
        </main>
        <Console />
      </div>
    );
  }
}

export default App;
