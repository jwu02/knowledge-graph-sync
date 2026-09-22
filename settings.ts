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
    // Re-read .env so edits to it show up without reloading the plugin.
    this.plugin.reloadEnvConfig();

    const { containerEl } = this;
    containerEl.empty();

    const managedKeys = this.plugin.envConfig.managedKeys;
    const isManaged = (key: keyof SyncSettings) => managedKeys.includes(key);
    // Managed controls are disabled, so this only differs from the persisted
    // values for the keys .env defines.
    const effective = this.plugin.getEffectiveSettings();

    if (managedKeys.length > 0) {
      this.renderEnvBanner(managedKeys.length);
    }

    new Setting(containerEl)
      .setName("MongoDB connection string")
      .setDesc(this.describe("URI used to connect to MongoDB.", isManaged("mongoUri")))
      .addText((text) =>
        text
          .setPlaceholder("mongodb://localhost:27017")
          .setValue(effective.mongoUri)
          .onChange(async (value) => {
            this.plugin.persistedSettings.mongoUri = value;
            await this.plugin.saveSettings();
          })
      )
      .setDisabled(isManaged("mongoUri"));

    new Setting(containerEl)
      .setName("Database name")
      .setDesc(
        this.describe(
          "Database containing the 'notes' collection. Defaults to activity-telemetry.",
          isManaged("dbName")
        )
      )
      .addText((text) =>
        text
          .setPlaceholder("activity-telemetry")
          .setValue(effective.dbName)
          .onChange(async (value) => {
            this.plugin.persistedSettings.dbName = value || DEFAULT_SETTINGS.dbName;
            await this.plugin.saveSettings();
          })
      )
      .setDisabled(isManaged("dbName"));

    new Setting(containerEl)
      .setName("Vault subdirectory")
      .setDesc(
        this.describe(
          "Only sync notes under this path, e.g. Projects. Leave empty to sync the whole vault.",
          isManaged("subdir")
        )
      )
      .addText((text) =>
        text
          .setPlaceholder("Projects")
          .setValue(effective.subdir)
          .onChange(async (value) => {
            this.plugin.persistedSettings.subdir = value.trim();
            await this.plugin.saveSettings();
          })
      )
      .setDisabled(isManaged("subdir"));

    new Setting(containerEl)
      .setName("Include notes that don't exist yet")
      .setDesc(
        this.describe(
          "Create placeholder nodes for wikilinks whose target file hasn't been written, so the graph shows notes you've referenced but not created. Placeholders have no outgoing links, and are removed on the next sync after you turn this off.",
          isManaged("includeUnresolved")
        )
      )
      .addToggle((toggle) =>
        toggle
          .setValue(effective.includeUnresolved)
          .onChange(async (value) => {
            this.plugin.persistedSettings.includeUnresolved = value;
            await this.plugin.saveSettings();
          })
      )
      .setDisabled(isManaged("includeUnresolved"));

    new Setting(containerEl)
      .setName("Verbose logging")
      .setDesc(
        this.describe(
          "Log date fallbacks and per-file details to the Obsidian developer console.",
          isManaged("verbose")
        )
      )
      .addToggle((toggle) =>
        toggle
          .setValue(effective.verbose)
          .onChange(async (value) => {
            this.plugin.persistedSettings.verbose = value;
            await this.plugin.saveSettings();
          })
      )
      .setDisabled(isManaged("verbose"));
  }

  private describe(description: string, managed: boolean): string {
    return managed ? `${description} Set by .env.` : description;
  }

  private renderEnvBanner(count: number): void {
    const envPath = this.plugin.getEnvPath();
    const banner = this.containerEl.createDiv();
    banner.style.cssText = [
      "padding: 8px 12px",
      "margin-bottom: 16px",
      "border-left: 3px solid var(--interactive-accent)",
      "border-radius: var(--radius-s)",
      "background-color: var(--background-secondary)",
      "color: var(--text-muted)",
      "font-size: var(--font-ui-smaller)",
      "line-height: 1.4",
    ].join("; ");
    banner.appendText(
      `${count} setting${count === 1 ? "" : "s"} below ${count === 1 ? "is" : "are"} set by the .env file and can't be edited here. Change ${count === 1 ? "it" : "them"} in `
    );
    banner.createEl("code", { text: envPath ?? ".env" });
    banner.appendText(". Everything else is saved here as usual.");
  }
}
