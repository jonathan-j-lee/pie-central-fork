import * as React from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import { ButtonGroup, H2, Intent } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import * as _ from 'lodash';

import { AddButton, ConfirmButton, EditButton } from '../EntityButtons';
import Bracket from './Bracket';
import Help from '../Help';
import MatchList from './MatchList';
import MatchEventList from './MatchEventList';
import ScorePlot from './ScorePlot';
import { AlertButton } from '../Notification';
import { DEV_ENV, PLACEHOLDER } from '../Util';
import { useAppDispatch, useAppSelector, useTeams, useQuery } from '../../hooks';
import {
  generate as generateBracket,
  remove as removeBracket,
} from '../../store/bracket';
import controlSlice from '../../store/control';
import {
  selectors as matchSelectors,
  addEvent,
  add as addMatch,
  save as saveMatches,
} from '../../store/matches';
import { getQualScore } from '../../../types';

function useQueriedMatch() {
  const location = useLocation();
  const history = useHistory();
  const query = useQuery();
  const matchId = query.has('match') ? Number(query.get('match')) : null;
  const matches = useAppSelector((state) => state.matches);
  if (!matchId) {
    if (matchId !== null) {
      history.push(location.pathname);
    }
    return;
  } else {
    return matchSelectors.selectById(matches, matchId);
  }
}

function ScheduleHelp(props: { transitionDuration?: number }) {
  return (
    <Help transitionDuration={props.transitionDuration}>
      <p>
        The final tournament is a best-of-three playoff where ties are ignored.
        To place alliances, every team is first assigned
        a <strong>qualification score</strong>:
      </p>
      <code className="bracket-formula">
        qual_score = 2000 * wins + 1000 * ties + total_score
      </code>
      <p>
        where <code>wins</code> and <code>ties</code> are the number of qualification
        matches won or tied, and <code>total_score</code> is the total number of points
        scored in qualification matches.
      </p>
      <p>
        Shepherd then ranks alliances using the average qualification score of their
        members. Byes are awarded starting from the highest-ranking alliance.
        Higher-ranking alliances also receive more favorable match-ups.
      </p>
      <p>
        As the formula suggests, winning matches is the best way to place strongly.
      </p>
      <p>
        A striped background indicates an ongoing match.
      </p>
    </Help>
  );
}

export default function Schedule(props: { transitionDuration?: number }) {
  const dispatch = useAppDispatch();
  const username = useAppSelector((state) => state.user.username);
  const bracket = useAppSelector((state) => state.bracket);
  const edit = useAppSelector((state) => state.control.editing);
  const setEdit = (editing: boolean) => dispatch(controlSlice.actions.update({ editing }));
  const match = useQueriedMatch();
  const teams = useTeams();
  return (
    <>
      <H2>Matches</H2>
      <Bracket edit={edit} />
      <MatchList edit={edit} />
      {match && (
        <>
          <H2 className="spacer">Events for Match {match?.id ?? PLACEHOLDER}</H2>
          <ScorePlot match={match} />
          <MatchEventList match={match} edit={edit} />
        </>
      )}
      <div className="control-bar spacer">
        <ButtonGroup>
          <ScheduleHelp transitionDuration={props.transitionDuration} />
          {(username || DEV_ENV) && (
            <>
              <EditButton edit={edit} setEdit={setEdit} />
              {edit && (
                <>
                  <AddButton text="Add match" onClick={() => dispatch(addMatch())} />
                  <AddButton
                    disabled={!match}
                    text="Add event"
                    onClick={() => match && dispatch(addEvent(match))}
                  />
                  <ConfirmButton
                    success="Saved match schedule."
                    failure="Failed to save match schedule."
                    onClick={() => dispatch(saveMatches()).unwrap()}
                    finalize={() => setEdit(false)}
                  />
                </>
              )}
            </>
          )}
        </ButtonGroup>
        {edit && (
          <ButtonGroup>
            <AlertButton
              warnings={bracket ? [
                'Generating a bracket will remove an existing one. ' +
                'Are you sure you want to continue?'
              ] : []}
              text="Generate bracket"
              intent={Intent.PRIMARY}
              icon={IconNames.MANY_TO_ONE}
              onClick={async () => {
                const alliances = _.chain(teams)
                  .groupBy((team) => team.alliance)
                  .mapValues((teams) =>
                    teams.reduce((total, team) =>
                      total + getQualScore(team.stats), 0)/teams.length
                  )
                  .toPairs()
                  .sortBy(([allianceId, score]) => -score)
                  .map(([allianceId]) => Number(allianceId))
                  .value();
                await dispatch(generateBracket(alliances)).unwrap();
              }}
              success="Generated bracket."
              failure="Failed to generate bracket."
              transitionDuration={props.transitionDuration}
            />
            <AlertButton
              warnings={['Are you sure you want to remove the current bracket?']}
              disabled={!bracket}
              text="Remove bracket"
              intent={Intent.DANGER}
              icon={IconNames.TRASH}
              onClick={async () => {
                await dispatch(removeBracket()).unwrap();
              }}
              success="Removed bracket."
              failure="Failed to remove bracket."
              transitionDuration={props.transitionDuration}
            />
          </ButtonGroup>
        )}
      </div>
    </>
  );
}
