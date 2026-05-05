import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.newaura.app',
  appName: 'New Aura',
  webDir: 'dist',
  plugins: {
    PushNotifications: {
      // Request permission automatically when app loads (can be changed to 'false'
      // if you want to ask for permission at a specific moment in the app flow)
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
