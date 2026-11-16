export type Category = "hardware" | "domains" | "api";
export const CATEGORIES = {
  hardware: "Hardware",
  domains: "Online Domains",
  api: "API Keys & Tools",
} as const;
export const QUESTIONS = [
  "What was the name of your first pet?",
  "What street did you grow up on?",
  "What was your first school?",
  "What was your childhood nickname?",
  "In which city did you meet your partner?",
  "What was your first car model?",
];
export interface Factors {
  password: boolean;
  pin: boolean;
  questions: string[];
  bound: boolean;
}
export interface Credentials {
  password: string;
  pin: string;
  answers: string[];
}
export interface Rules {
  min: number;
  max: number;
  length: number;
  upper: boolean;
  lower: boolean;
  numbers: boolean;
  symbols: boolean;
  allowedSymbols: string;
  allowed: string;
  excluded: string;
  ambiguous: boolean;
  minUpper: number;
  minLower: number;
  minNumbers: number;
  minSymbols: number;
  noRepeat: boolean;
  truncates: number | null;
  mode: "password" | "passphrase";
  words: number;
  separator: string;
  capitalize: boolean;
}
export const DEFAULT_RULES: Rules = {
  min: 8,
  max: 128,
  length: 20,
  upper: true,
  lower: true,
  numbers: true,
  symbols: true,
  allowedSymbols: "!@#$%^&*()-_=+",
  allowed: "",
  excluded: "",
  ambiguous: true,
  minUpper: 1,
  minLower: 1,
  minNumbers: 1,
  minSymbols: 1,
  noRepeat: true,
  truncates: null,
  mode: "password",
  words: 8,
  separator: "-",
  capitalize: false,
};
export function preset(category: Category): Rules {
  return {
    ...DEFAULT_RULES,
    length: category === "api" ? 40 : category === "domains" ? 16 : 20,
    symbols: category !== "api",
    minSymbols: category === "api" ? 0 : 1,
  };
}
export interface PastSecret {
  id: string;
  value: string;
  replacedAt: string;
}
export interface Entry {
  id: string;
  name: string;
  username: string;
  location: string;
  notes: string;
  tags: string[];
  category: Category;
  createdAt: string;
  updatedAt: string;
  rotatedAt: string;
  rotationDays: number | null;
  rules: Rules;
  current: string;
  past: PastSecret[];
  pending: { value: string; createdAt: string } | null;
}
export interface Preferences {
  advanced: boolean;
  theme: "dark" | "light" | "system";
  reducedMotion: boolean;
  autoLockMinutes: number;
  clipboardSeconds: number;
  rotationReminders: boolean;
  breachEnabled: boolean;
  backupDirectory: string;
  lastBackupAt: string | null;
}
export const DEFAULT_PREFERENCES: Preferences = {
  advanced: false,
  theme: "dark",
  reducedMotion: false,
  autoLockMinutes: 5,
  clipboardSeconds: 30,
  rotationReminders: true,
  breachEnabled: false,
  backupDirectory: "",
  lastBackupAt: null,
};
export interface Vault {
  version: 1;
  entries: Entry[];
  preferences: Preferences;
  presets: { name: string; rules: Rules }[];
}
export interface PublicStatus {
  exists: boolean;
  unlocked: boolean;
  factors: Factors | null;
  retryAt: number;
  quickUnlock: boolean;
  preferences: Pick<Preferences, "theme" | "reducedMotion">;
}
export interface ImportRow {
  id: string;
  name: string;
  username: string;
  location: string;
  secret: string;
  notes: string;
  category: Category | "unsorted";
  skip: boolean;
  duplicateId?: string;
  resolution: "keep" | "replace" | "both";
  unmapped: string[];
}
export interface ImportPreview {
  token: string;
  rows: ImportRow[];
  headers: string[];
  mapping: Record<string, string>;
  format: string;
  pathLabel: string;
}
export interface Result<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}
export interface VaultAPI {
  request<T = unknown>(command: unknown): Promise<Result<T>>;
  onLock(callback: () => void): () => void;
}
declare global {
  interface Window {
    vault: VaultAPI;
  }
}
