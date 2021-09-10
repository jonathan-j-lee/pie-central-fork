import { configureStore } from '@reduxjs/toolkit';
import { TypedUseSelectorHook, useDispatch, useSelector } from 'react-redux';
import alliances from './alliances';
import bracket from './bracket';
import control, { wsClient } from './control';
import matches from './matches';
import teams from './teams';
import user from './user';

const store = configureStore({
  reducer: {
    alliances: alliances.reducer,
    bracket: bracket.reducer,
    control: control.reducer,
    matches: matches.reducer,
    teams: teams.reducer,
    user: user.reducer,
  },
  middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(wsClient),
});

export default store;
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
