const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
// Expo inlines this selector but its stock transform key omits the value.
// Native CI also ignores --reset-cache. Partition every export and QA build.
const fixtureMode = process.env.EXPO_PUBLIC_VIMICATE_UI_FIXTURE || null;
config.cacheVersion += `:vimicate-ui-fixture-v1:${JSON.stringify(fixtureMode)}`;

module.exports = config;
