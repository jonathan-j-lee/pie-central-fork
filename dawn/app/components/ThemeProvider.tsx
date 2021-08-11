import * as React from 'react';
import { Classes } from '@blueprintjs/core';
import { useAppSelector } from '../hooks';
import { EditorTheme } from '../store/settings';

export default function ThemeProvider(props: { children: React.ReactNode }) {
  const editorTheme = useAppSelector((state) => state.settings.editor.editorTheme);
  React.useEffect(() => {
    if (editorTheme === EditorTheme.DARK) {
      document.body.classList.add(Classes.DARK);
    } else {
      document.body.classList.remove(Classes.DARK);
    }
  }, [editorTheme]);
  /* We use an effect instead of wrapping the children in a `div` to ensure theming
     applies to portals that are children of `body`. */
  return <>{props.children}</>;
}
