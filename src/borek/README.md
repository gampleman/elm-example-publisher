# Borek

Borek is an abstract build system. What do we mean by build system?

```javascript
const tasks = async (target, get) => {
  console.log(`Executing ${target}`);
  switch (target) {
    // we want to build target foo
    case "foo":
      // here we declare a dependency on bar
      // this dependency relationship will get automatically tracked
      const bar = await get("bar");
      // We return the result
      return bar + 1;
    case "bar":
      return 2;
  }
};
const build = buildSystem({ tasks, store: inMemoryStore });

await build("foo"); // => 3
// Executing foo
// Executing bar
await build("foo"); // => 3
// no logs - everything is cached
store.invalidate("foo");
await build("foo"); // => 3
// Executing foo
// bar isn't logged
store.invalidate("bar");
await build("foo"); // => 3
// Executing bar
// Executing foo
```

Borek implements the `buildSystem` function above (and some other optional pieces to get going quicker).

In more concrete terms: Borek manages the execution of tasks in the following manner - It will start by computing the first key. When it encounters a `await get(dependency)` call, it will suspend execution of the initial task and check wheather it has that key in its cache. If not, it will then execute the task for that key and so on.

However it also records what dependencies each tasks has. So when a certain value is marked as stale in the cache, Borek will execute tasks to ensure that everything in the chain is up to date:

```
    E
   / \
  C   D
  |
  B
  |
  A
```

In the above diagram, if we are requestig E, and B gets marked stale, then:
B will be recomputed:

1.  If the value is the same as the one recorded previously, then we are done and E can be returned from the cache.
2.  If the value is different, then C will be recomputed.
    1. If C is the same, then we are done and E can be returned from the cache.
    2. If C is different, than E will be recomputed and its value returned.

As you can see, Borek will always only re-rerun the minimal amount of tasks to ensure the correct result.

## Important Caveat

Given how this works, Borek assumes a certain amount of determinism in tasks. Specifically the output as well as what dependencies a task has should only depend on the values of its dependencies. So this is fine (and also more powerful than many other build systems like Make):

```javascript
const tasks = async (key, get) => {
    //...
    case "target":
        if (await get("foo")) {
            return doSomething(await get("bar"));
        } else {
            return doSomething(await get("opo"));
        }
}
```

since wheather `target` depends on `bar` or `opo` is entirely determined by the value of `foo`. So as long as `foo` doesn't change, then the dependencies of `target` are the same and everything will work. When `foo` changes, then `target` will be recomputed anyway, and the dependency tracking will be updated and everything will work just fine.

On the other hand, this will not work:

```javascript
const tasks = async (key, get) => {
    //...
    case "target":
        if (Math.random() > 0.5) {
            return doSomething(await get("bar"));
        } else {
            return doSomething(await get("opo"));
        }
}
```

However, this would:

```javascript
const tasks = async (key, get) => {
    //...
    case "target":
        if (Math.random() > 0.5) {
            return Volatile(doSomething(await get("bar")));
        } else {
            return Volatile(doSomething(await get("opo")));
        }
}
```

The special Volatile value will mean that the cache will automatically be marked stale at the end of the run, and so the function will be re-run every run. This allows you to model indeterminism at the cost of efficiency.
