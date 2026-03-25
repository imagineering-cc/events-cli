/**
 * In-process async mutex for serialising access to a shared resource.
 *
 * MCP hosts (e.g. Claude Code) can fire multiple tool calls concurrently.
 * Playwright browser contexts are not safe for concurrent use — simultaneous
 * operations on the same context corrupt state. This mutex ensures only one
 * tool call touches the browser at a time; others queue up and wait.
 *
 * Hat-tip to @m13v's browser-lock for surfacing this concurrency pattern.
 * His implementation uses filesystem locks for cross-process safety; ours
 * is in-process because the MCP server is a single Node process handling
 * serialised stdio, but the principle is identical.
 */
export class Mutex {
  private queue: Array<() => void> = [];
  private locked = false;

  /** Acquire the mutex. Resolves when it's your turn. */
  acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.queue.push(resolve));
  }

  /** Release the mutex, allowing the next waiter to proceed. */
  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.locked = false;
    }
  }
}
