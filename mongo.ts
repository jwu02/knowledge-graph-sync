import { MongoClient, Collection, BulkWriteResult } from "mongodb";
import type { NoteSnapshot } from "./types";

export interface SyncCounts {
  inserted: number;
  updated: number;
  deleted: number;
}

export class MongoStore {
  private client: MongoClient | null = null;
  private readonly uri: string;
  private readonly dbName: string;
  private readonly collectionName = "notes";

  constructor(uri: string, dbName: string) {
    this.uri = uri;
    this.dbName = dbName;
  }

  async connect(): Promise<void> {
    if (!this.client) {
      this.client = new MongoClient(this.uri);
      await this.client.connect();
    }
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
  }

  private getCollection(): Collection<NoteSnapshot> {
    if (!this.client) {
      throw new Error("MongoDB client is not connected");
    }
    return this.client.db(this.dbName).collection<NoteSnapshot>(this.collectionName);
  }

  async syncNotes(snapshot: NoteSnapshot[]): Promise<SyncCounts> {
    const collection = this.getCollection();
    const filenames = snapshot.map((n) => n.filename);

    const operations = snapshot.map((note) => ({
      replaceOne: {
        filter: { filename: note.filename },
        replacement: note,
        upsert: true,
      },
    }));

    let inserted = 0;
    let modified = 0;
    if (operations.length > 0) {
      const result: BulkWriteResult = await collection.bulkWrite(operations);
      inserted = result.upsertedCount;
      modified = result.modifiedCount;
    }

    let deleted = 0;
    if (filenames.length > 0) {
      const deleteResult = await collection.deleteMany({
        filename: { $nin: filenames },
      });
      deleted = deleteResult.deletedCount || 0;
    }

    return { inserted, updated: modified, deleted };
  }
}
