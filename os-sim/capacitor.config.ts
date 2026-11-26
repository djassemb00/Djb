import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'os.nova.shell',
  appName: 'NovaOS',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
    backgroundColor: '#05070d',
  },
  server: {
    androidScheme: 'https',
  },
};

export default config;
