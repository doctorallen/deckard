import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';

import { reportError } from '../timing';
import { SearchWorkerReply, SearchWorkerRequest } from './searchStoreWorker';

/**
 * The thread that writes the full-text cache, and the extension host's end of
 * the conversation with it.
 *
 * The thread is opened when the first build needs it rather than at start, so
 * a session that only reads an already-built cache never pays for one. What
 * it writes is a cache either way: when the thread cannot be opened, or dies,
 * the store writes on the host as it always did, which is slower and never
 * wrong.
 */
export class SearchWorkerClient {
  private worker?: Worker;
  /** False once opening the thread has failed, so it is not tried again. */
  private available = true;
  private nextId = 1;
  private readonly pending = new Set<number>();
  private readonly idleWaiters: Array<() => void> = [];

  public constructor(
    private readonly databasePath: string,
    /** Called when batches were lost, so their caller can take stock. */
    private readonly onLost: () => void,
  ) {}

  /**
   * Hands a batch to the thread, and says whether it took it. A batch it
   * would not take is the caller's to write.
   */
  public send(request: Omit<SearchWorkerRequest, 'id'>): boolean {
    const worker = this.open();
    if (!worker) {
      return false;
    }
    const id = this.nextId;
    this.nextId += 1;
    this.pending.add(id);
    const message: SearchWorkerRequest = { ...request, id };
    worker.postMessage(message);
    return true;
  }

  /** Resolves once every batch handed over so far has been written. */
  public whenIdle(): Promise<void> {
    return this.pending.size === 0
      ? Promise.resolve()
      : new Promise<void>((resolve) => this.idleWaiters.push(resolve));
  }

  public dispose(): void {
    this.available = false;
    const worker = this.worker;
    this.worker = undefined;
    this.settleAll();
    void worker?.terminate();
  }

  private open(): Worker | undefined {
    if (this.worker || !this.available) {
      return this.worker;
    }
    const workerPath = findWorkerScript();
    if (!workerPath) {
      this.available = false;
      return undefined;
    }
    try {
      const worker = new Worker(workerPath, {
        workerData: { databasePath: this.databasePath },
      });
      worker.on('error', (error) => {
        reportError('The search index worker stopped', error);
        this.lose();
      });
      // A thread that has died takes the batches it was given with it. They
      // are written again by the next scan, which finds them missing.
      worker.on('exit', () => this.lose());
      worker.on('message', (reply: SearchWorkerReply) => {
        if ('error' in reply) {
          reportError('The search index worker could not write a batch', reply.error);
          this.onLost();
        }
        this.settle(reply.id);
      });
      // A cache being written should not hold the extension host open.
      worker.unref();
      this.worker = worker;
      return worker;
    } catch (error) {
      reportError('The search index worker could not be started', error);
      this.available = false;
      return undefined;
    }
  }

  private settle(id: number): void {
    this.pending.delete(id);
    if (this.pending.size === 0) {
      this.idleWaiters.splice(0).forEach((resolve) => resolve());
    }
  }

  private settleAll(): void {
    this.pending.clear();
    this.idleWaiters.splice(0).forEach((resolve) => resolve());
  }

  /** Gives up on the batches in flight and says so. */
  private lose(): void {
    const lost = this.pending.size > 0;
    this.settleAll();
    if (lost) {
      this.onLost();
    }
  }
}

/**
 * The worker's script, which sits beside this one however Deckard was built:
 * next to the bundle esbuild writes, and next to this file's own JavaScript
 * when the tests compile the sources as they stand.
 */
function findWorkerScript(): string | undefined {
  const candidate = join(__dirname, 'searchStoreWorker.js');
  return existsSync(candidate) ? candidate : undefined;
}
