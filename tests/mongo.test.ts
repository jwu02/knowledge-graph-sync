import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoStore } from "../mongo";

let mongod: MongoMemoryServer;
let uri: string;
let store: MongoStore;

describe("MongoStore", () => {
  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    uri = mongod.getUri();
  });

  afterAll(async () => {
    await mongod.stop();
  });

  beforeEach(async () => {
    store = new MongoStore(uri, "test-activity");
    await store.connect();
    const client = new (await import("mongodb")).MongoClient(uri);
    await client.connect();
    await client.db("test-activity").collection("notes").deleteMany({});
    await client.close();
  });

  afterEach(async () => {
    await store.close();
  });

  it("upserts notes and deletes missing ones", async () => {
    const first = await store.syncNotes([
      { filename: "A", createdAt: new Date("2024-01-01"), links: ["B"] },
      { filename: "B", createdAt: new Date("2024-01-02"), links: [] },
    ]);
    expect(first.inserted).toBe(2);
    expect(first.updated).toBe(0);
    expect(first.deleted).toBe(0);

    const second = await store.syncNotes([
      { filename: "A", createdAt: new Date("2024-01-01"), links: ["C"] },
      { filename: "C", createdAt: new Date("2024-01-03"), links: [] },
    ]);
    expect(second.inserted).toBe(1);
    expect(second.updated).toBe(1);
    expect(second.deleted).toBe(1);
  });
});
