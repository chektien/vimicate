import { registerRootComponent } from 'expo';

import App from './App';
import { installFatalDiagnostics } from './src/diagnostics/installFatalDiagnostics';
import { installRuntimeEventLedger } from './src/diagnostics/installRuntimeEventLedger';

installFatalDiagnostics();
installRuntimeEventLedger();

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
