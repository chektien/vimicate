// Version-coupled RN 0.86 application hook. The app's diagnostics owner is its
// sole registrant; keep the exception opaque and return it without alteration.
declare module 'react-native/Libraries/Core/ExceptionsManager' {
  const manager: { unstable_setExceptionDecorator?: (decorator: (data: unknown) => unknown) => void };
  export default manager;
}
