// OAuth client configuration for cloud sync. Client IDs for public/PKCE
// clients (which is what both providers use here — a plain static site, no
// backend, no client secret) aren't secret the way a password is: the real
// security boundary is the redirect URI / authorized-origin allowlist each
// provider enforces on its own console, not the ID's secrecy. It's normal
// practice to ship them in client-side code.
//
// Set these via Vite env vars (a .env file locally, or repo/environment
// variables in whatever builds the GitHub Pages deploy) so the same source
// works across dev and prod without editing code:
//   VITE_GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
//   VITE_MS_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
//
// See the project README / the setup notes from whoever wired this up for
// exactly how to obtain each one.

export const GOOGLE_CLIENT_ID: string = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';
export const MS_CLIENT_ID: string = import.meta.env.VITE_MS_CLIENT_ID ?? '';

export const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const MS_GRAPH_SCOPES = ['Files.ReadWrite.AppFolder', 'User.Read'];

/** The one file each provider stores the full backup in. Google Drive's
 *  `drive.file` scope only ever sees files this app itself created, so the
 *  name just needs to be stable, not hidden. */
export const SYNC_FILE_NAME = 'cashflow-sync-backup.json';

export function isGoogleConfigured(): boolean {
  return GOOGLE_CLIENT_ID.trim() !== '';
}

export function isOneDriveConfigured(): boolean {
  return MS_CLIENT_ID.trim() !== '';
}
