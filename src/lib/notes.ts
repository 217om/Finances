// Notes are global — independent of which card is active — so they live in
// their own small IndexedDB database, separate from every card's database.

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

export interface Note {
  id: string;
  title: string;
  body: string;
  createdAt: number;
  updatedAt: number;
}

interface NotesDB extends DBSchema {
  notes: {
    key: string; // Note.id
    value: Note;
  };
}

const DB_NAME = 'cashflow-notes';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<NotesDB>> | null = null;

function getDB(): Promise<IDBPDatabase<NotesDB>> {
  if (!dbPromise) {
    dbPromise = openDB<NotesDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore('notes', { keyPath: 'id' });
      },
      terminated() {
        dbPromise = null;
      },
    });
  }
  return dbPromise;
}

export async function getAllNotes(): Promise<Note[]> {
  const db = await getDB();
  const all = await db.getAll('notes');
  all.sort((a, b) => b.updatedAt - a.updatedAt);
  return all;
}

export async function saveNote(note: Note): Promise<void> {
  const db = await getDB();
  await db.put('notes', note);
}

export async function deleteNote(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('notes', id);
}

function randomId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return Math.random().toString(36).slice(2);
  }
}

export function makeNote(title = 'New note'): Note {
  const now = Date.now();
  return { id: randomId(), title, body: '', createdAt: now, updatedAt: now };
}
