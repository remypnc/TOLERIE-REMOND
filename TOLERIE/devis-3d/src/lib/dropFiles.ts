// Fichiers déposés (glisser-déposer) : fichiers isolés ou dossiers entiers, parcourus récursivement.
// On garde ce que l'atelier sait lire (images, PDF, CAO, 3D) et on ignore les fichiers système.

const READABLE = /\.(png|jpe?g|webp|gif|heic|bmp|tiff?|pdf|dxf|dwg|step|stp|iges|igs|brep|stl|obj|sldprt|zip)$/i;
const MAX_FILES = 40;

type Entry = FileSystemEntry & Partial<FileSystemFileEntry & FileSystemDirectoryEntry>;

const fileOf = (e: FileSystemFileEntry) => new Promise<File>((ok, ko) => e.file(ok, ko));

/** Toutes les entrées d'un dossier (le navigateur les livre par paquets). */
async function entriesOf(dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = dir.createReader();
  const all: FileSystemEntry[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((ok, ko) => reader.readEntries(ok, ko));
    if (!batch.length) return all;
    all.push(...batch);
  }
}

async function walk(entry: Entry, out: File[]) {
  if (out.length >= MAX_FILES || entry.name.startsWith('.')) return;
  if (entry.isFile) {
    const f = await fileOf(entry as FileSystemFileEntry);
    if (READABLE.test(f.name) || f.type.startsWith('image/')) out.push(f);
  } else if (entry.isDirectory) {
    for (const child of await entriesOf(entry as FileSystemDirectoryEntry)) await walk(child as Entry, out);
  }
}

/** Fichiers lisibles d'un dépôt : dossiers compris, 40 au plus ; repli sur la liste simple si le navigateur ne donne pas les entrées. */
export async function droppedFiles(dt: DataTransfer): Promise<File[]> {
  const entries = [...dt.items].map((i) => (i.kind === 'file' ? (i.webkitGetAsEntry() as Entry | null) : null)).filter((e): e is Entry => !!e);
  if (!entries.length) return [...dt.files].filter((f) => READABLE.test(f.name) || f.type.startsWith('image/')).slice(0, MAX_FILES);
  const out: File[] = [];
  for (const e of entries) await walk(e, out);
  return out;
}

/** Le glisser concerne-t-il des fichiers (et pas du texte ou un élément de la page) ? */
export const hasFiles = (dt: DataTransfer | null) => !!dt && [...dt.types].includes('Files');
