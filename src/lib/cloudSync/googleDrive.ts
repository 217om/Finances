// Google Drive provider — uses Google Identity Services (GIS) for auth (a
// pure client-side token flow, no backend needed) and the Drive REST API
// directly via fetch. Scoped to `drive.file`, so the app can only ever see
// files it created itself, never the rest of the user's Drive.
//
// GIS doesn't persist tokens across reloads on its own; `connected` here
// tracks "the user has granted access before" in localStorage, and each API
// call lazily gets a fresh token, first trying a silent (non-interactive)
// grant and only falling back to a visible consent popup if that fails —
// e.g. the very first connect, or if access was revoked externally.

import { GOOGLE_CLIENT_ID, GOOGLE_DRIVE_SCOPE, SYNC_FILE_NAME, isGoogleConfigured } from './config';
import type { CloudProvider } from './types';

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const CONNECTED_KEY = 'cashflow.cloudSync.google.connected';
const ACCOUNT_KEY = 'cashflow.cloudSync.google.account';

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(config: {
            client_id: string;
            scope: string;
            prompt?: string;
            callback: (resp: { access_token?: string; error?: string }) => void;
            error_callback?: (err: { type?: string; message?: string }) => void;
          }): { requestAccessToken: (opts?: { prompt?: string }) => void };
          revoke(token: string, done: () => void): void;
        };
      };
    };
  }
}

let gisLoadPromise: Promise<void> | null = null;
function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gisLoadPromise) return gisLoadPromise;
  gisLoadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${GIS_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Could not load Google Sign-In.')));
      return;
    }
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Could not load Google Sign-In.'));
    document.head.appendChild(script);
  });
  return gisLoadPromise;
}

let cachedToken: { value: string; expiresAt: number } | null = null;

function readLS(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeLS(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}
function removeLS(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** Gets a usable access token, silently refreshing first and only prompting
 *  interactively when silent refresh doesn't produce one. */
async function getToken(interactive: boolean): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.value;
  await loadGis();
  if (!window.google) throw new Error('Google Sign-In did not load.');

  return new Promise<string>((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: GOOGLE_DRIVE_SCOPE,
      callback: (resp) => {
        if (resp.error || !resp.access_token) {
          reject(new Error(resp.error || 'Google did not grant access.'));
          return;
        }
        // Google doesn't report the exact lifetime here; access tokens are
        // consistently ~1 hour, so refresh a little early to be safe.
        cachedToken = { value: resp.access_token, expiresAt: Date.now() + 55 * 60_000 };
        resolve(resp.access_token);
      },
      error_callback: (err) => {
        reject(new Error(err.message || 'Google sign-in was cancelled.'));
      },
    });
    client.requestAccessToken(interactive ? undefined : { prompt: '' });
  });
}

async function fetchAccountLabel(token: string): Promise<string | null> {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { email?: string };
    return data.email ?? null;
  } catch {
    return null;
  }
}

async function findFileId(token: string): Promise<string | null> {
  const q = encodeURIComponent(`name='${SYNC_FILE_NAME}' and trashed=false`);
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`Google Drive lookup failed (${res.status}).`);
  const data = (await res.json()) as { files?: { id: string }[] };
  return data.files?.[0]?.id ?? null;
}

export const googleDriveProvider: CloudProvider = {
  id: 'google',
  name: 'Google Drive',

  isConfigured() {
    return isGoogleConfigured();
  },

  isConnected() {
    return readLS(CONNECTED_KEY) === '1';
  },

  async connect() {
    const token = await getToken(true);
    writeLS(CONNECTED_KEY, '1');
    const email = await fetchAccountLabel(token);
    if (email) writeLS(ACCOUNT_KEY, email);
  },

  disconnect() {
    if (cachedToken) {
      try {
        window.google?.accounts.oauth2.revoke(cachedToken.value, () => {});
      } catch {
        /* ignore */
      }
    }
    cachedToken = null;
    removeLS(CONNECTED_KEY);
    removeLS(ACCOUNT_KEY);
  },

  getAccountLabel() {
    return readLS(ACCOUNT_KEY);
  },

  async upload(json: string) {
    const token = await getToken(false);
    const existingId = await findFileId(token);
    if (existingId) {
      const res = await fetch(
        `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=media`,
        {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: json,
        },
      );
      if (!res.ok) throw new Error(`Google Drive upload failed (${res.status}).`);
      return;
    }
    const boundary = 'cashflow-sync-boundary';
    const metadata = { name: SYNC_FILE_NAME, mimeType: 'application/json' };
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: application/json\r\n\r\n${json}\r\n` +
      `--${boundary}--`;
    const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
    if (!res.ok) throw new Error(`Google Drive upload failed (${res.status}).`);
  },

  async download() {
    const token = await getToken(false);
    const fileId = await findFileId(token);
    if (!fileId) return null;
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Google Drive download failed (${res.status}).`);
    return res.text();
  },
};
