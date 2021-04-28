const withObjectInterface = (obj) => {
  return async (target, get) => {
    const wrappedObj = Object.keys(obj).reduce(
      (wrapper, key) => ({
        ...wrapper,
        [key]: (...args) => get({ method: key, args }),
      }),
      {}
    );

    if (target.method && obj[target.method])
      return await obj[target.method].apply(wrappedObj, target.args);
    else throw new Error(`undefined method ${target.method}`);
  };
};

module.exports = withObjectInterface;
