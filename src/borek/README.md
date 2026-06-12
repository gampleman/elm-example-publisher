# Borek

Borek is an abstract incremental build system. You describe your build as a set
of tasks; Borek tracks the dependencies between them and, on a rebuild, recomputes
only the tasks whose inputs actually changed.

The primary interface is a class. Subclass `Borek<Input>` and define `async`
methods — each method is a task. Inside a task, calling `this.otherTask(...)`
records a dependency and returns that task's built (cached) value; calling a task
method on the instance from outside runs a build targeting it:

```ts
class Calc extends Borek<{ start: number }> {
  async foo() {
    // Awaiting another method records a dependency, automatically tracked.
    return (await this.bar()) + 1;
  }
  async bar() {
    // this.input(key) reads a value from the constructor argument (Volatile).
    return await this.input("start");
  }
}

const calc = new Calc({ start: 2 }, { store: inMemoryStore() });

await calc.foo(); // => 3, runs foo + bar
await calc.foo(); // => 3, fully cached, nothing re-runs
```

## Depending on the filesystem

To depend on files, use the tracked-IO helpers rather than `node:fs` directly —
each one reads (or copies/lists) **and** records the dependency in a single call,
so there's no separate "declare a dependency" step to forget:

```ts
class Site extends Borek<{ dir: string }> {
  async parse(file: string) {
    const source = await this.readFile(file); // reads AND tracks `file`
    return parse(source);
  }
  async all() {
    // globFiles tracks the *set* of matching paths: add/remove of a match
    // re-runs this task, while edits flow through each parse()'s readFile.
    const files = await this.globFiles(join(await this.input("dir"), "*.elm"));
    return Promise.all(files.map((f) => this.parse(f)));
  }
}
```

- `this.readFile(path)` / `this.readJSON(path)` — read a file and depend on it.
- `this.copyFile(from, to)` — copy `from` (depending on it) to `to`; returns a
  `File` marker for `to` so the destination can be recorded as an output too.
- `this.globFiles(pattern)` — the sorted matching paths, depending on that set.
- `this.file(path)` / `this.glob(pattern)` — the underlying primitives, if you
  need to record a dependency without reading (e.g. a file another tool reads).

Under the hood this is driven by a lower-level functional core, `buildSystem`,
which takes a `tasks` function of `(key, get) => value` (the class adapter turns
each method into such a task). The `Volatile`, `File`, `Glob`, store, and watch
helpers are the other pieces.

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
