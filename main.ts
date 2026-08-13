import { Plugin, Notice } from "obsidian";
import { DEFAULT_SETTINGS, KnowledgeGraphSyncSettingTab } from "./settings";
import { MongoStore } from "./mongo";
import { runSync } from "./sync";
import type { SyncSettings } from "./types";

export default class KnowledgeGraphSyncPlugin extends Plugin {
  settings: SyncSettings;
  private mongoStore: MongoStore | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.addCommand({
      id: "sync-knowledge-graph",
      name: "Sync knowledge graph to MongoDB",
      callback: async () => {
        await this.performSync();
      },
    });

    this.addSettingTab(new KnowledgeGraphSyncSettingTab(this.app, this));
  }

  onunload(): void {
    this.mongoStore?.close();
    this.mongoStore = null;
  }

  private async getMongoStore(): Promise<MongoStore> {
    if (!this.mongoStore) {
      this.mongoStore = new MongoStore(this.settings.mongoUri, this.settings.dbName);
      await this.mongoStore.connect();
    }
    return this.mongoStore;
  }

  private async performSync(): Promise<void> {
    try {
      const mongoStore = await this.getMongoStore();
      const result = await runSync(
        this.app.vault,
        this.app.metadataCache,
        mongoStore,
        this.settings
      );

      if (result.errors.length > 0) {
        for (const err of result.errors) {
          console.error("[Knowledge Graph Sync]", err);
        }
      }

      const message = `Synced ${result.inserted + result.updated + result.deleted} notes: ${result.inserted} added, ${result.updated} updated, ${result.deleted} removed.`;
      new Notice(message, 5000);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[Knowledge Graph Sync]", message);
      new Notice(`Sync failed: ${message}`, 8000);
      this.mongoStore?.close();
      this.mongoStore = null;
    }
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
