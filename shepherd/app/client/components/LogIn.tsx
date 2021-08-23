import * as React from 'react';
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
import request from 'superagent';
import * as _ from 'lodash';
import { notifySuccess, OutcomeButton } from './Notification';
import { useAppDispatch, useAppSelector } from '../store';
import { logIn, logOut } from '../store/user';

export default function LogIn() {
  const dispatch = useAppDispatch();
  const username = useAppSelector((state) => state.user.username);
  const [show, setShow] = React.useState(false);
  const [error, setError] = React.useState<Error | null>(null);
  React.useEffect(() => {
    dispatch(logIn());
  }, [dispatch]);
  return (
    <>
      {username && <code id="username-label">{username}</code>}
      <Button
        icon={username ? IconNames.LOG_OUT : IconNames.LOG_IN}
        text={username ? 'Log out' : 'Log in'}
        onClick={async () => {
          if (username) {
            await dispatch(logOut()).unwrap();
            notifySuccess('Successfully logged out.');
          } else {
            setShow(true);
          }
        }}
      />
      <Dialog
        isOpen={show}
        icon={IconNames.LOG_IN}
        title="Log in"
        onClose={() => setShow(false)}
      >
        <div className={Classes.DIALOG_BODY}>
          <form id="login">
            <FormGroup label="Username" labelInfo="(required)" labelFor="username">
              <InputGroup id="username" name="username" placeholder="Username" />
            </FormGroup>
            <FormGroup label="Password" labelInfo="(required)" labelFor="password">
              <InputGroup
                id="password"
                name="password"
                type="password"
                placeholder="Password"
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
            <OutcomeButton
              icon={IconNames.CONFIRM}
              intent={Intent.SUCCESS}
              text="Log in"
              onClick={async () => {
                const form = document.getElementById('login') as HTMLFormElement | null;
                if (form) {
                  const formData = new FormData(form).entries();
                  const payload = _.fromPairs(Array.from(formData));
                  try {
                    await dispatch(logIn(payload)).unwrap();
                    notifySuccess('Successfully logged in.');
                    setError(null);
                    setShow(false);
                  } catch (err) {
                    setError(err);
                  }
                }
              }}
            />
          </div>
        </div>
      </Dialog>
    </>
  );
}
