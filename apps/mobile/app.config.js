// app.json supplies checkout-specific defaults. Contributor mode is explicit.
// The public snapshot already contains isolated contributor defaults.
module.exports = ({ config }) => {
  const mode = process.env.VIMICATE_BUILD_MODE;
  if (!mode || mode === 'production') return config;
  if (mode !== 'contributor') throw new Error('Unknown VIMICATE_BUILD_MODE. Use contributor or production.');

  const contributor = JSON.parse(JSON.stringify(config));
  contributor.name = 'Vimicate Contributor';
  contributor.slug = 'vimicate-contributor';
  contributor.scheme = 'vimicate-contributor';
  delete contributor.owner;
  contributor.updates = { enabled: false, checkAutomatically: 'NEVER' };
  delete contributor.runtimeVersion;
  contributor.ios.bundleIdentifier = 'org.vimicate.contributor';
  contributor.ios.buildNumber = '1';
  delete contributor.ios.appleTeamId;
  delete contributor.ios.entitlements;
  contributor.ios.infoPlist = {
    ...contributor.ios.infoPlist,
    VimicateKeychainScope: 'application',
  };
  contributor.extra = {
    appFlavor: 'vimicate-contributor',
    storageNamespace: 'org.vimicate.contributor',
  };
  return contributor;
};
