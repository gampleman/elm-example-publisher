// Adapts a plain object of async methods into a Borek `tasks` function. Each
// method becomes a task keyed by { method, args }; within a method, calling
// `this.otherMethod(...)` records a dependency and returns its built value.
const withObjectInterface = (obj) => {
  return async (target, get) => {
    const wrappedObj = Object.keys(obj).reduce(
      (wrapper, key) => ({
        ...wrapper,
        [key]: (...args) => get({ method: key, args }),
      }),
      {},
    );

    if (target.method && obj[target.method])
      return await obj[target.method].apply(wrappedObj, target.args);
    else throw new Error(`undefined method ${target.method}`);
  };
};

export default withObjectInterface;
