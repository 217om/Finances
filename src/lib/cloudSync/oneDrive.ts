// OneDrive provider — uses MSAL.js (a client-side-only auth library built
// for exactly this SPA-no-backend scenario) against a personal Microsoft
// account, and the Microsoft Graph API's "app root" special folder, which
// plays the same role as Google Drive's `drive.file` scope: the app can only
// see the one folder it owns, never the rest of the user's OneDrive.
//
// Unlike Google Identity Services, MSAL keeps its own token cache (in
// localStorage) and refreshes silently on its own, so reconnecting after a
// reload is normally invisible to the user once they've connected once.

// @azure/msal-browser is a sizeable dependency (~280 KB) that only matters to
// the minority of visitors who actually connect OneDrive, so it's imported
// dynamically below rather than at module load — everyone else's initial
// bundle stays free of it.
import type { AccountInfo, PublicClientApplication } from '@azure/msal-browser';
import { MS_CLIENT_ID, MS_GRAPH_SCOPES, SYNC_FILE_NAME, isOneDriveConfigured } from './config';
import type { CloudProvider } from './types';

// Must exactly match a redirect URI registered on the Azure app (as a
// "Single-page application" platform entry) — see the setup notes.
const REDIRECT_URI = `${window.location.origin}${window.location.pathname}`;

let msalInstance: PublicClientApplication | null = null;
let initPromise: Promise<PublicClientApplication> | null = null;

function getMsal(): Promise<PublicClientApplication> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const { PublicClientApplication } = await import('@azure/msal-browser');
    const instance = new PublicClientApplication({
      auth: {
        clientId: MS_CLIENT_ID,
        // "consumers" scopes sign-in to personal Microsoft accounts only,
        // matching a plain personal OneDrive — see setup notes for the
        // matching Azure app-registration account type.
        authority: 'https://login.microsoftonline.com/consumers',
        redirectUri: REDIRECT_URI,
      },
      cache: {
        cacheLocation: 'localStorage',
      },
    });
    await instance.initialize();
    msalInstance = instance;
    return instance;
  })();
  return initPromise;
}

function currentAccount(instance: PublicClientApplication): AccountInfo | null {
  const accounts = instance.getAllAccounts();
  return accounts[0] ?? null;
}

async function getToken(interactive: boolean): Promise<string> {
  const instance = await getMsal();
  const account = currentAccount(instance);
  if (account) {
    try {
      const result = await instance.acquireTokenSilent({ scopes: MS_GRAPH_SCOPES, account });
      return result.accessToken;
    } catch (e) {
      if (!interactive) throw e;
    }
  }
  if (!interactive) throw new Error('Not connected to OneDrive.');
  const result = await instance.acquireTokenPopup({ scopes: MS_GRAPH_SCOPES });
  return result.accessToken;
}

const GRAPH_ROOT = 'https://graph.microsoft.com/v1.0/me/drive/special/approot';
const MAX_SIMPLE_UPLOAD_BYTES = 4 * 1024 * 1024;

export const oneDriveProvider: CloudProvider = {
  id: 'onedrive',
  name: 'OneDrive',

  isConfigured() {
    return isOneDriveConfigured();
  },

  isConnected() {
    if (!msalInstance) {
      // Before the first getMsal() call in this page load, fall back to
      // whatever MSAL already persisted in localStorage from a prior visit.
      try {
        const raw = localStorage.getItem(`msal.account.keys-${MS_CLIENT_ID}`);
        return raw !== null;
      } catch {
        return false;
      }
    }
    return currentAccount(msalInstance) !== null;
  },

  async connect() {
    const instance = await getMsal();
    const result = await instance.acquireTokenPopup({ scopes: MS_GRAPH_SCOPES });
    instance.setActiveAccount(result.account);
  },

  disconnect() {
    if (!msalInstance) return;
    const account = currentAccount(msalInstance);
    if (account) void msalInstance.clearCache({ account });
  },

  getAccountLabel() {
    if (!msalInstance) return null;
    return currentAccount(msalInstance)?.username ?? null;
  },

  async upload(json: string) {
    const bytes = new TextEncoder().encode(json).length;
    if (bytes > MAX_SIMPLE_UPLOAD_BYTES) {
      throw new Error('Backup is too large for OneDrive sync (over 4 MB).');
    }
    const token = await getToken(false);
    const res = await fetch(`${GRAPH_ROOT}:/${SYNC_FILE_NAME}:/content`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: json,
    });
    if (!res.ok) throw new Error(`OneDrive upload failed (${res.status}).`);
  },

  async download() {
    const token = await getToken(false);
    const res = await fetch(`${GRAPH_ROOT}:/${SYNC_FILE_NAME}:/content`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`OneDrive download failed (${res.status}).`);
    return res.text();
  },
};
