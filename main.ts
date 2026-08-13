import { Plugin, Notice } from "obsidian";
import { DEFAULT_SETTINGS, KnowledgeGraphSyncSettingTab } from "./settings";
import type { SyncSettings, SyncResult } from "./types";

export default class KnowledgeGraphSyncPlugin extends Plugin {
  settings: SyncSettings;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.addCommand({
      id: "sync-knowledge-graph",
      name: "Sync knowledge graph to MongoDB",
      callback: async () => {
        new Notice("Sync not yet implemented");
      },
    });

    this.addSettingTab(new KnowledgeGraphSyncSettingTab(this.app, this));
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
