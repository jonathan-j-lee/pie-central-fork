import * as React from 'react';
import { ButtonGroup, H2, Intent } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';

import { AddButton, ConfirmButton, EditButton } from '../EntityButtons';
import Bracket from './Bracket';
import MatchList from './MatchList';
import MatchEventList from './MatchEventList';
import { DEV_ENV, PLACEHOLDER, AlertButton } from '../Util';
import { useAppDispatch, useAppSelector, useQuery } from '../../hooks';
import {
  generate as generateBracket,
  remove as removeBracket,
} from '../../store/bracket';
import {
  selectors as matchSelectors,
  addEvent,
  add as addMatch,
  save as saveMatches,
} from '../../store/matches';

export default function Schedule() {
  const dispatch = useAppDispatch();
  const matchesState = useAppSelector((state) => state.matches);
  const username = useAppSelector((state) => state.user.username);
  const bracket = useAppSelector((state) => state.bracket);
  const [edit, setEdit] = React.useState(false);
  const query = useQuery();
  // TODO: redirect if does not exist
  // TODO: add visualization (cumulative score, timeline)
  // TODO: add tournament bracket visualization
  const matchId = query.get('match') ? Number(query.get('match')) : null;
  const match = matchId ? matchSelectors.selectById(matchesState, matchId) : undefined;
  return (
    <>
      <H2>Matches</H2>
      <Bracket edit={edit} />
      <MatchList edit={edit} />
      {match && (
        <>
          <H2 className="spacer">Events for Match {matchId ?? PLACEHOLDER}</H2>
          <MatchEventList match={match} edit={edit} />
        </>
      )}
      {(username || DEV_ENV) && (
        <div className="control-bar spacer">
          <ButtonGroup>
            <EditButton edit={edit} setEdit={setEdit} />
            {edit && (
              <>
                <AddButton text="Add match" onClick={() => dispatch(addMatch())} />
                {match && (
                  <AddButton
                    text="Add event"
                    onClick={() => dispatch(addEvent(match))}
                  />
                )}
                <ConfirmButton
                  onClick={() => {
                    dispatch(saveMatches());
                    setEdit(false);
                  }}
                />
              </>
            )}
          </ButtonGroup>
          {edit && (
            <ButtonGroup>
              <AlertButton
                getWarnings={() => bracket ? [
                  'Generating a bracket will delete an existing one. ' +
                  'Are you sure you want to continue?'
                ] : []}
                text="Generate bracket"
                intent={Intent.PRIMARY}
                icon={IconNames.MANY_TO_ONE}
                onClick={async () => {
                  await dispatch(generateBracket()).unwrap();
                }}
              />
              <AlertButton
                getWarnings={() => ['Are you sure you want to delete the current bracket?']}
                disabled={!bracket}
                text="Remove bracket"
                intent={Intent.DANGER}
                icon={IconNames.TRASH}
                onClick={async () => {
                  await dispatch(removeBracket()).unwrap();
                }}
              />
            </ButtonGroup>
          )}
        </div>
      )}
    </>
  );
}
