// Public entry of cairngorm.json, the user's settings file. Kept free of UI so any feature can
// read settings cheaply; the Settings section is "@/config/settings-file-section".
export {
  getConfig,
  getConfigError,
  getConfigPath,
  loadConfig,
  parseConfig,
  subscribeConfig,
  updateConfig,
  watchConfig,
  type ConfigData,
} from "./data/config-store";
