import { describe, it, expect } from "vitest";
import { Mutex } from "./mutex.js";

describe("Mutex", () => {
  it("acquires immediately when unlocked", async () => {
    const mutex = new Mutex();
    // Should resolve synchronously (returned Promise.resolve())
    await mutex.acquire();
    mutex.release();
  });

  it("queues a second caller until the first releases", async () => {
    const mutex = new Mutex();
    await mutex.acquire();

    let secondResolved = false;
    const second = mutex.acquire().then(() => {
      secondResolved = true;
    });

    // Yield to the microtask queue — second should still be waiting
    await Promise.resolve();
    expect(secondResolved).toBe(false);

    mutex.release();
    await second;
    expect(secondResolved).toBe(true);

    mutex.release();
  });

  it("releases waiters in FIFO order", async () => {
    const mutex = new Mutex();
    await mutex.acquire();

    const order: number[] = [];

    const a = mutex.acquire().then(() => order.push(1));
    const b = mutex.acquire().then(() => order.push(2));
    const c = mutex.acquire().then(() => order.push(3));

    // Release three times to let all waiters through
    mutex.release(); // lets a through
    await a;
    mutex.release(); // lets b through
    await b;
    mutex.release(); // lets c through
    await c;

    expect(order).toEqual([1, 2, 3]);

    mutex.release();
  });

  it("can be re-acquired after full release", async () => {
    const mutex = new Mutex();

    // First cycle
    await mutex.acquire();
    mutex.release();

    // Second cycle — should not deadlock
    await mutex.acquire();
    mutex.release();
  });

  it("serialises concurrent work — no interleaving", async () => {
    const mutex = new Mutex();
    const log: string[] = [];

    async function work(id: string, steps: number) {
      await mutex.acquire();
      try {
        for (let i = 0; i < steps; i++) {
          log.push(`${id}:${i}`);
          // Yield to give other tasks a chance to interleave (they shouldn't)
          await new Promise((r) => setTimeout(r, 1));
        }
      } finally {
        mutex.release();
      }
    }

    // Fire three workers concurrently
    await Promise.all([work("a", 3), work("b", 2), work("c", 2)]);

    // All of a's steps should be contiguous, then b's, then c's
    expect(log).toEqual(["a:0", "a:1", "a:2", "b:0", "b:1", "c:0", "c:1"]);
  });
});
