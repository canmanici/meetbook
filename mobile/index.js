// App entry. Background handlers (data-only call pushes, lock-screen call
// buttons) are registered here, in the entry module, because a headless
// start from a push or a notification button never renders the route tree.
import 'expo-router/entry';

import * as SplashScreen from 'expo-splash-screen';

import { registerBackgroundHandlers } from './src/lib/background-handlers';

// Short splash fade: a lock-screen call launch should reach the call screen
// without waiting on a long transition.
SplashScreen.setOptions({ duration: 150, fade: true });

registerBackgroundHandlers();
