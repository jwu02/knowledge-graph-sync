import { App, PluginSettingTab, Setting } from "obsidian";
import type { SyncSettings } from "./types";
import type KnowledgeGraphSyncPlugin from "./main";

export const DEFAULT_SETTINGS: SyncSettings = {
  mongoUri: "",
  dbName: "activity-telemetry",
  subdir: "",
  verbose: false,
  includeUnresolved: false,
};

export class KnowledgeGraphSyncSettingTab extends PluginSettingTab {
  plugin: KnowledgeGraphSyncPlugin;

  constructor(app: App, plugin: KnowledgeGraphSyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("MongoDB connection string")
      .setDesc("URI used to connect to MongoDB.")
      .addText((text) =>
        text
          .setPlaceholder("mongodb://localhost:27017")
          .setValue(this.plugin.settings.mongoUri)
          .onChange(async (value) => {
            this.plugin.settings.mongoUri = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Database name")
      .setDesc("Database containing the 'notes' collection. Defaults to activity-telemetry.")
      .addText((text) =>
        text
          .setPlaceholder("activity-telemetry")
          .setValue(this.plugin.settings.dbName)
          .onChange(async (value) => {
            this.plugin.settings.dbName = value || DEFAULT_SETTINGS.dbName;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Vault subdirectory")
      .setDesc("Only sync notes under this path, e.g. Projects. Leave empty to sync the whole vault.")
      .addText((text) =>
        text
          .setPlaceholder("Projects")
          .setValue(this.plugin.settings.subdir)
          .onChange(async (value) => {
            this.plugin.settings.subdir = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Include notes that don't exist yet")
      .setDesc(
        "Create placeholder nodes for wikilinks whose target file hasn't been written, so the graph shows notes you've referenced but not created. Placeholders have no outgoing links, and are removed on the next sync after you turn this off."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.includeUnresolved)
          .onChange(async (value) => {
            this.plugin.settings.includeUnresolved = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Verbose logging")
      .setDesc("Log date fallbacks and per-file details to the Obsidian developer console.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.verbose)
          .onChange(async (value) => {
            this.plugin.settings.verbose = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
