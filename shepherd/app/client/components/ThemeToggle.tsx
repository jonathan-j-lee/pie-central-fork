import * as React from 'react';
import { Classes, Icon, Switch, IconSize } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useAppDispatch, useAppSelector } from '../hooks';
import { save } from '../store/user';

export default function ThemeToggle() {
  const dispatch = useAppDispatch();
  const darkTheme = useAppSelector((state) => state.user.darkTheme);
  React.useEffect(() => {
    if (darkTheme) {
      document.body.classList.add(Classes.DARK);
    } else {
      document.body.classList.remove(Classes.DARK);
    }
  }, [darkTheme]);
  return (
    <Switch
      className="theme-toggle"
      large
      inline
      checked={darkTheme}
      onChange={() => dispatch(save({ darkTheme: !darkTheme }))}
      labelElement={<Icon icon={IconNames.MOON} size={IconSize.LARGE} />}
    />
  );
}
