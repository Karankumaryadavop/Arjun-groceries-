import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';
import {
  initPWAListeners,
  markSWOfflineReady,
  markSWRegisterError,
  markSWRegistered,
  markSWUpdateAvailable,
  setPWAUpdateHandler,
} from './utils/pwaInstall';

// Capture beforeinstallprompt / appinstalled immediately before Welcome or Login screens mount
initPWAListeners();

if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      // Never auto-reload mid-transaction; wait for explicit user approval in SafeUpdateBanner
      markSWUpdateAvailable();
    },
    onOfflineReady() {
      markSWOfflineReady();
    },
    onRegisteredSW(_swUrl, registration) {
      markSWRegistered(registration);
    },
    onRegisterError(err) {
      markSWRegisterError(err);
    },
  });
  setPWAUpdateHandler(updateSW);
}

createRoot(document.getElementById('root')!).render(<App />);
