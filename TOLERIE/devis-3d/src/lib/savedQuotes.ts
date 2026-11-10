// Devis enregistrés sans envoi : gardés dans ce navigateur pour être repris plus tard.
// Rien ne part à l'atelier ; l'envoi en production reste un geste explicite du client.
import type { ChatMessage, MissingField, PartSpec } from './types';

export interface SavedQuote {
  reference: string;
  savedAt: string;
  spec: PartSpec;
  answered: MissingField[];
  /** Conversation au moment de l'enregistrement (sans les aperçus de fichiers, non conservables). */
  messages: ChatMessage[];
  unitPrice: number;
  subtotal: number;
  thumbnail?: string;
}

const KEY = 'tr-devis-enregistres';
const MAX = 20;

export function listSaved(): SavedQuote[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(raw) ? (raw as SavedQuote[]).filter((q) => q && q.reference && q.spec) : [];
  } catch {
    return [];
  }
}

function write(list: SavedQuote[]): boolean {
  // Si le stockage est plein, on retire d'abord les aperçus des plus anciens, puis les plus anciens eux-mêmes.
  let l = list.slice(0, MAX);
  for (let i = 0; i < 2 * MAX; i++) {
    try {
      localStorage.setItem(KEY, JSON.stringify(l));
      return true;
    } catch {
      const j = l.findLastIndex((q, k) => k > 0 && q.thumbnail);
      if (j > 0) l = l.map((q, k) => (k === j ? { ...q, thumbnail: undefined } : q));
      else if (l.length > 1) l = l.slice(0, -1);
      else return false;
    }
  }
  return false;
}

/** Enregistre (ou met à jour, même référence) un devis ; le plus récent en tête. */
export function saveQuote(q: SavedQuote): boolean {
  const clean: SavedQuote = {
    ...q,
    messages: q.messages.map((m) => (m.attachments ? { ...m, attachments: m.attachments.map((a) => ({ ...a, url: undefined })) } : m)),
  };
  return write([clean, ...listSaved().filter((x) => x.reference !== q.reference)]);
}

export function deleteSaved(reference: string): SavedQuote[] {
  const l = listSaved().filter((x) => x.reference !== reference);
  write(l);
  return l;
}
