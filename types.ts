export interface NoteSnapshot {
  filename: string;
  createdAt: Date;
  links: string[];
}

export interface SyncSettings {
  mongoUri: string;
  dbName: string;
  subdir: string;
  verbose: boolean;
  /** Emit placeholder nodes (and keep the edges) for wikilinks with no file. */
  includeUnresolved: boolean;
}

export interface SyncResult {
  inserted: number;
  updated: number;
  deleted: number;
  errors: string[];
}
