export const makeUpdateReducer = name => (state, action) => {
  state[name] = action.payload;
};
