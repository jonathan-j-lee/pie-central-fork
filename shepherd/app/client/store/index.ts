import { configureStore } from '@reduxjs/toolkit';
import alliances from './alliances';
import bracket from './bracket';
import control, { wsClient } from './control';
import log from './log';
import matches from './matches';
import teams from './teams';
import user from './user';

const store = configureStore({
  reducer: {
    alliances: alliances.reducer,
    bracket: bracket.reducer,
    control: control.reducer,
    log: log.reducer,
    matches: matches.reducer,
    teams: teams.reducer,
    user: user.reducer,
  },
  middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(wsClient),
});

export default store;
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
