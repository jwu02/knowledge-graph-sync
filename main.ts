import { FileSystemAdapter, Notice, Plugin, normalizePath } from "obsidian";
import { DEFAULT_SETTINGS, KnowledgeGraphSyncSettingTab } from "./settings";
import { EMPTY_ENV_CONFIG, effectiveSettings, readEnvConfig } from "./env-config";
import type { EnvConfig } from "./env-config";
import { MongoStore } from "./mongo";
import { runSync } from "./sync";
import type { SyncSettings } from "./types";

export default class KnowledgeGraphSyncPlugin extends Plugin {
  /** Values the settings UI owns; this is what gets saved to data.json. */
  persistedSettings: SyncSettings;
  /** Values read from the plugin directory's .env file, if there is one. */
  envConfig: EnvConfig = EMPTY_ENV_CONFIG;

  private mongoStore: MongoStore | null = null;
  private mongoStoreKey: string | null = null;

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

  /**
   * The settings a sync actually runs with. Precedence per key: built-in
   * defaults, then values saved in the settings UI, then .env.
   */
  getEffectiveSettings(): SyncSettings {
    return effectiveSettings(
      DEFAULT_SETTINGS,
      this.persistedSettings,
      this.envConfig.settings
    );
  }

  /** Absolute path of the plugin's .env file, or null if it can't be resolved. */
  getEnvPath(): string | null {
    // Only desktop adapters expose a real filesystem path; isDesktopOnly is set
    // in the manifest, but guard anyway so a missing .env is never fatal.
    const adapter = this.app.vault.adapter as FileSystemAdapter;
    if (typeof adapter?.getBasePath !== "function") {
      return null;
    }
    if (!this.manifest.dir) {
      return null;
    }
    return normalizePath(`${adapter.getBasePath()}/${this.manifest.dir}/.env`);
  }

  /**
   * Re-reads .env. A missing file is the normal setup and yields no settings;
   * a malformed one only produces console warnings, never a failed sync.
   */
  reloadEnvConfig(): void {
    const envPath = this.getEnvPath();
    this.envConfig = envPath ? readEnvConfig(envPath) : EMPTY_ENV_CONFIG;
    for (const warning of this.envConfig.warnings) {
      console.warn("[Knowledge Graph Sync]", warning);
    }
  }

  private async getMongoStore(settings: SyncSettings): Promise<MongoStore> {
    const key = `${settings.mongoUri}|${settings.dbName}`;
    if (this.mongoStore && this.mongoStoreKey !== key) {
      await this.mongoStore.close();
      this.mongoStore = null;
      this.mongoStoreKey = null;
    }
    if (!this.mongoStore) {
      this.mongoStore = new MongoStore(settings.mongoUri, settings.dbName);
      this.mongoStoreKey = key;
      await this.mongoStore.connect();
    }
    return this.mongoStore;
  }

  private async performSync(): Promise<void> {
    try {
      // Re-read .env so an edit applies to the very next sync.
      this.reloadEnvConfig();
      const settings = this.getEffectiveSettings();
      const mongoStore = await this.getMongoStore(settings);
      const result = await runSync(
        this.app.vault,
        this.app.metadataCache,
        mongoStore,
        settings
      );

      if (result.errors.length > 0) {
        for (const err of result.errors) {
          console.error("[Knowledge Graph Sync]", err);
        }
        new Notice(`Sync failed with ${result.errors.length} error(s). See developer console for details.`, 8000);
        return;
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
    this.persistedSettings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.reloadEnvConfig();
  }

  async saveSettings(): Promise<void> {
    // Only the UI-owned layer is persisted; .env values are never copied here.
    await this.saveData(this.persistedSettings);
  }
}
