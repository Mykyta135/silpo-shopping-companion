import { promises as fs } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import type { ShoppingList } from '@silpo/shared';

/**
 * The guest's active shopping list.
 *
 * File-backed, like TokenStore. Almost nothing is stored on our side — profile,
 * receipts, prices and coupons all live in Silpo and are fetched through MCP on
 * demand — so the list is the only real state we own.
 *
 * The interface is deliberately narrow (`get`/`save`/`mutate`/`clear`) so
 * swapping in Postgres later touches this file alone.
 */
@Injectable()
export class ListStore {
  private readonly logger = new Logger(ListStore.name);
  private readonly filePath = resolve(
    process.env.LIST_STORE_PATH ?? '.shopping-lists.json',
  );
  private cache = new Map<string, ShoppingList>();
  private loaded = false;
  /** Serialises read-modify-write cycles so concurrent sessions can't clobber the file. */
  private writeChain: Promise<void> = Promise.resolve();

  async get(sessionId: string): Promise<ShoppingList | undefined> {
    await this.load();
    return this.cache.get(sessionId);
  }

  async save(list: ShoppingList): Promise<void> {
    await this.load();
    this.cache.set(list.sessionId, list);
    await this.persist();
  }

  /**
   * Applies a mutation to the stored list and persists the result.
   * @throws Error when no list exists for the session.
   */
  async mutate(
    sessionId: string,
    fn: (list: ShoppingList) => void,
  ): Promise<ShoppingList> {
    await this.load();
    const list = this.cache.get(sessionId);
    if (!list) throw new Error(`No shopping list for session ${sessionId}`);
    fn(list);
    this.cache.set(sessionId, list);
    await this.persist();
    return list;
  }

  async clear(sessionId: string): Promise<void> {
    await this.load();
    this.cache.delete(sessionId);
    await this.persist();
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      this.cache = new Map(
        Object.entries(JSON.parse(raw) as Record<string, ShoppingList>),
      );
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn(`Could not read list store: ${(err as Error).message}`);
      }
      this.cache = new Map();
    }
    this.loaded = true;
  }

  private persist(): Promise<void> {
    this.writeChain = this.writeChain.then(async () => {
      const payload = JSON.stringify(Object.fromEntries(this.cache), null, 2);
      await fs.mkdir(dirname(this.filePath), { recursive: true });
      await fs.writeFile(this.filePath, payload, { mode: 0o600 });
    });
    return this.writeChain;
  }
}
