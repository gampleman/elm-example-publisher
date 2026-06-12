// A minimal async semaphore: limits how many tasks run concurrently. Used to
// cap the number of headless-browser pages open at once, since opening one per
// example in parallel starves constrained CI machines (and times out).
export type Semaphore = <T>(task: () => Promise<T>) => Promise<T>;

export const createSemaphore = (limit: number): Semaphore => {
  let active = 0;
  const queue: (() => void)[] = [];

  const release = () => {
    active--;
    const next = queue.shift();
    if (next) next();
  };

  return <T>(task: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const run = () => {
        active++;
        task().then(
          (value) => {
            release();
            resolve(value);
          },
          (error) => {
            release();
            reject(error);
          },
        );
      };
      if (active < limit) run();
      else queue.push(run);
    });
};
