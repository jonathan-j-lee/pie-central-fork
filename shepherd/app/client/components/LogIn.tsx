import { useAppDispatch, useAppSelector } from '../hooks';
import { logIn, logOut } from '../store/user';
import { ConfirmButton } from './EntityButtons';
import { notifySuccess, notifyFailure } from './Notification';
import {
  Button,
  Callout,
  Classes,
  Dialog,
  FormGroup,
  Intent,
  InputGroup,
} from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import * as React from 'react';

function LogInButton(props: { show: () => void }) {
  const dispatch = useAppDispatch();
  const username = useAppSelector((state) => state.user.username);
  return (
    <>
      {username && <code id="username-label">{username}</code>}
      <Button
        className="log-in"
        icon={username ? IconNames.LOG_OUT : IconNames.LOG_IN}
        text={username ? 'Log out' : 'Log in'}
        onClick={async () => {
          if (username) {
            try {
              await dispatch(logOut()).unwrap();
              notifySuccess('Successfully logged out.');
            } catch {
              notifyFailure('Failed to log out.');
            }
          } else {
            props.show();
          }
        }}
      />
    </>
  );
}

export default function LogIn(props: { transitionDuration?: number }) {
  const dispatch = useAppDispatch();
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [show, setShow] = React.useState(false);
  const [error, setError] = React.useState<Error | null>(null);
  React.useEffect(() => {
    dispatch(logIn());
  }, [dispatch]);
  const sendLogIn = React.useCallback(async () => {
    try {
      await dispatch(logIn({ username, password })).unwrap();
      notifySuccess('Successfully logged in.');
      setError(null);
      setShow(false);
    } catch (err) {
      setError(err);
    }
  }, [username, password, setShow, setError]);
  return (
    <>
      <LogInButton show={() => setShow(true)} />
      <Dialog
        isOpen={show}
        icon={IconNames.LOG_IN}
        title="Log in"
        onClose={() => setShow(false)}
        transitionDuration={props.transitionDuration}
      >
        <div className={Classes.DIALOG_BODY}>
          <form id="login">
            <FormGroup label="Username" labelInfo="(required)" labelFor="username">
              <InputGroup
                id="username"
                name="username"
                placeholder="Username"
                onBlur={({ currentTarget: { value } }) => setUsername(value)}
              />
            </FormGroup>
            <FormGroup label="Password" labelInfo="(required)" labelFor="password">
              <InputGroup
                id="password"
                name="password"
                type="password"
                placeholder="Password"
                onBlur={({ currentTarget: { value } }) => setPassword(value)}
              />
            </FormGroup>
          </form>
          {error && (
            <Callout intent={Intent.DANGER}>
              <p className="callout-message">Invalid credentials.</p>
            </Callout>
          )}
        </div>
        <div className={Classes.DIALOG_FOOTER}>
          <div className={Classes.DIALOG_FOOTER_ACTIONS}>
            <ConfirmButton text="Log in" onClick={sendLogIn} />
          </div>
        </div>
      </Dialog>
    </>
  );
}
