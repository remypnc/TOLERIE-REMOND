import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import type { Attachment, ChatMessage, Choice, MissingField, PartSpec } from '../lib/types';
import { attachmentFiles } from '../lib/cadImport';
import { specRecap } from '../lib/recap';
import { ASSISTANT_NAME } from '../lib/assistant';
import { Icon } from './Icons';
import styles from './Chat.module.css';

export interface ChatProps {
  messages: ChatMessage[];
  typing: boolean;
  /** Libellé de la barre de chargement pendant un long traitement (IA, import 3D). */
  workLabel?: string;
  /** Modifier un message déjà envoyé : la conversation et la pièce reviennent à ce moment-là. */
  onEditMessage?: (m: ChatMessage) => void;
  onSend: (text: string, attachments: Attachment[]) => void;
  onChoice: (c: Choice) => void;
  /** Texte injecté dans le champ (ex. depuis un outil d'édition) ; change `nonce` pour réinjecter. */
  prefill?: { text: string; nonce: number };
  placeholder?: string;
}

function kindOf(file: File): Attachment['kind'] {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (file.type.startsWith('image/')) return 'image';
  if (ext === 'pdf') return 'pdf';
  if (['dxf', 'dwg', 'step', 'stp', 'igs', 'iges', 'sldprt', 'stl', 'obj', 'brep'].includes(ext)) return 'cad';
  return 'other';
}

export function filesToAttachments(files: FileList | File[]): Attachment[] {
  return Array.from(files).map((f) => {
    const id = crypto.randomUUID();
    // Le fichier reste disponible pour l'import 3D (STEP, IGES, STL, OBJ, DXF).
    attachmentFiles.set(id, f);
    return {
    id,
    name: f.name,
    kind: kindOf(f),
    size: f.size,
    url: f.type.startsWith('image/') ? URL.createObjectURL(f) : undefined,
  };
  });
}

const ACCEPT = 'image/*,.pdf,.dxf,.dwg,.step,.stp,.igs,.iges,.brep,.stl,.obj,.zip';

// ---- Bulles --------------------------------------------------------------

export function Bubble({ m, compact = false, onEdit }: { m: ChatMessage; compact?: boolean; onEdit?: (m: ChatMessage) => void }) {
  const editable = onEdit && m.role === 'user' && m.snapshot && m.text;
  return (
    <div className={`${styles.bubble} ${m.role === 'user' ? styles.user : styles.assistant} ${compact ? styles.compact : ''} ${editable ? styles.editable : ''}`}>
      {editable && (
        <button type="button" className={styles.editMsg} onClick={() => onEdit(m)} title="Modifier ce message et repartir de là" aria-label="Modifier ce message">
          <Icon name="pencil" size={13} />
        </button>
      )}
      {m.attachments && m.attachments.length > 0 && (
        <div className={styles.atts}>
          {m.attachments.map((a) =>
            a.kind === 'image' && a.url ? (
              <img key={a.id} src={a.url} alt={a.name} className={styles.thumb} />
            ) : (
              <span key={a.id} className={styles.file}>
                <Icon name="clip" size={14} /> {a.name}
              </span>
            ),
          )}
        </div>
      )}
      {m.text && <p>{m.text}</p>}
      {m.recap && !compact && <RecapCard spec={m.recap.spec} version={m.recap.version} />}
    </div>
  );
}

/** Fiche de la pièce telle que l'assistant l'a comprise : à vérifier d'un coup d'œil. */
function RecapCard({ spec, version }: { spec: PartSpec; version: number }) {
  return (
    <div className={styles.recap}>
      <header>
        <Icon name="cube" size={15} />
        <b>{spec.name}</b>
        <span title={`Version ${version} de la pièce`}>v{version}</span>
      </header>
      <dl>
        {specRecap(spec).map((r) => (
          <div key={r.label}><dt>{r.label}</dt><dd>{r.value}</dd></div>
        ))}
      </dl>
    </div>
  );
}

export function Choices({ m, onChoice, disabled }: { m?: ChatMessage; onChoice: (c: Choice) => void; disabled?: boolean }) {
  if (!m?.choices?.length) return null;
  return (
    <div className={styles.choices}>
      {m.choices.map((c) => (
        <button key={c.value} type="button" className={`${styles.choice} ${c.value === '__preview__' ? styles.choicePrimary : ''}`} onClick={() => onChoice(c)} disabled={disabled}>
          {c.value === '__preview__' && <Icon name="eye" size={16} />}
          {c.label}
        </button>
      ))}
      {m.allowCustom && <span className={styles.customHint}>ou répondez librement ↓</span>}
    </div>
  );
}

/** L'assistant écrit ; avec `label`, une barre de chargement (IA qui génère la pièce, lecture d'un fichier 3D…). */
export function Typing({ label }: { label?: string }) {
  if (label) {
    return (
      <div className={`${styles.bubble} ${styles.assistant} ${styles.working}`} role="status" aria-live="polite">
        <span><Icon name="sparkle" size={14} /> {label}</span>
        <i className={styles.bar}><b /></i>
      </div>
    );
  }
  return (
    <div className={`${styles.bubble} ${styles.assistant} ${styles.typing}`} aria-label={`${ASSISTANT_NAME} écrit`}>
      <i /><i /><i />
    </div>
  );
}

// ---- Champ de saisie avec pièces jointes ----------------------------------

// ---- Dictée vocale (Web Speech API : Chrome, Edge, Safari) ---------------------

interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
}
const SpeechRecognitionCtor = (window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }).SpeechRecognition
  ?? (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition;

/** Dicte dans le champ : le texte reconnu s'ajoute à ce qui est déjà tapé, en direct. */
function useDictation(setText: (t: string) => void, getText: () => string) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string>();
  const rec = useRef<Recognition | null>(null);
  useEffect(() => () => rec.current?.stop(), []);
  const toggle = () => {
    if (!SpeechRecognitionCtor) return;
    if (rec.current) return rec.current.stop();
    const r = new SpeechRecognitionCtor();
    r.lang = 'fr-FR';
    r.interimResults = true;
    r.continuous = true;
    const before = getText().trim();
    let done = '';
    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) done += t;
        else interim += t;
      }
      setText([before, (done + interim).trim()].filter(Boolean).join(' '));
    };
    r.onerror = (e) => setError(e.error === 'not-allowed' ? 'Micro refusé : autorisez-le dans le navigateur.' : e.error === 'no-speech' ? undefined : 'Dictée indisponible pour le moment.');
    r.onend = () => {
      rec.current = null;
      setListening(false);
    };
    rec.current = r;
    setError(undefined);
    setListening(true);
    r.start();
  };
  return { supported: !!SpeechRecognitionCtor, listening, error, toggle };
}

/** Zone de la pièce désignée sur la 3D (face, panneau) : bulle jointe au message, préfixée à l'envoi. */
export interface ComposerContext {
  label: string;
  prefix: string;
  onClear: () => void;
}

export function Composer({ onSend, prefill, placeholder = 'Décrivez votre pièce, une cote…', big = false, context, incoming }: Pick<ChatProps, 'onSend' | 'prefill' | 'placeholder'> & { big?: boolean; context?: ComposerContext | null; incoming?: { atts: Attachment[]; nonce: number } }) {
  const [text, setText] = useState('');
  const [atts, setAtts] = useState<Attachment[]>([]);
  // Fichiers déposés ailleurs (zone de dépôt) : ils rejoignent les pièces jointes en attente, au-dessus de la saisie.
  useEffect(() => {
    if (incoming?.atts.length) setAtts((l) => [...l, ...incoming.atts]); // eslint-disable-line react-hooks/set-state-in-effect
  }, [incoming]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef(text);
  useEffect(() => {
    textRef.current = text;
  }, [text]);
  const mic = useDictation(setText, () => textRef.current);

  useEffect(() => {
    if (!prefill) return;
    setText(prefill.text);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  }, [prefill]);

  const send = () => {
    if (!text.trim() && atts.length === 0) return;
    if (mic.listening) mic.toggle();
    onSend(context && text.trim() ? `${context.prefix}${text.trim()}` : text.trim(), atts);
    setText('');
    setAtts([]);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className={`${styles.composer} ${big ? styles.composerBig : ''}`}>
      {(atts.length > 0 || context) && (
        <div className={styles.pending}>
          {context && (
            <span className={`${styles.file} ${styles.zone}`}>
              <Icon name="cursor" size={13} />
              {context.label}
              <button type="button" aria-label={`Ne plus viser ${context.label}`} onClick={context.onClear}>
                <Icon name="close" size={12} />
              </button>
            </span>
          )}
          {atts.map((a) => (
            <span key={a.id} className={styles.file}>
              {a.kind === 'image' && a.url ? <img src={a.url} alt="" /> : <Icon name="clip" size={14} />}
              {a.name}
              <button type="button" aria-label={`Retirer ${a.name}`} onClick={() => setAtts((l) => l.filter((x) => x.id !== a.id))}>
                <Icon name="close" size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className={styles.row}>
        <button type="button" className={styles.iconBtn} aria-label="Joindre un fichier (photo, croquis, plan, DXF, STEP)" title="Photo, croquis, PDF, DXF, STEP…" onClick={() => fileRef.current?.click()}>
          <Icon name="clip" />
        </button>
        <input ref={fileRef} type="file" multiple accept={ACCEPT} hidden onChange={(e) => { if (e.target.files) setAtts((l) => [...l, ...filesToAttachments(e.target.files!)]); e.target.value = ''; }} />
        <textarea
          ref={inputRef}
          rows={1}
          value={text}
          placeholder={mic.listening ? 'Je vous écoute… décrivez votre pièce' : placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          onPaste={(e) => { if (e.clipboardData.files.length) setAtts((l) => [...l, ...filesToAttachments(e.clipboardData.files)]); }}
        />
        {mic.supported && (
          <button type="button" className={`${styles.iconBtn} ${mic.listening ? styles.micOn : ''}`} onClick={mic.toggle} aria-pressed={mic.listening}
            aria-label={mic.listening ? 'Arrêter la dictée' : 'Dicter au micro'} title={mic.listening ? 'Arrêter la dictée' : 'Parler au lieu d’écrire'}>
            <Icon name="mic" />
          </button>
        )}
        <button type="button" className={styles.sendBtn} aria-label="Envoyer" onClick={send} disabled={!text.trim() && atts.length === 0}>
          <Icon name="send" size={18} />
        </button>
      </div>
      {mic.error && <p className={styles.micError}>{mic.error}</p>}
    </div>
  );
}

// ---- Fenêtre flottante rétractable (étape 1) --------------------------------

export interface Step {
  field: MissingField;
  label: string;
  done: boolean;
}

interface DockProps extends ChatProps {
  expanded: boolean;
  onExpandedChange: (v: boolean) => void;
  /** Étapes de la description (forme, dimensions…) : cliquer revient sur l'une pour la modifier. */
  steps: Step[];
  onStep: (field: MissingField) => void;
  onPreview: () => void;
  context?: ComposerContext | null;
}

export function ChatDock({ messages, typing, workLabel, onEditMessage, onSend, onChoice, prefill, expanded, onExpandedChange, steps, onStep, onPreview, context }: DockProps) {
  const [incoming, setIncoming] = useState<{ atts: Attachment[]; nonce: number }>();
  const dropInput = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(false);
  const last = messages[messages.length - 1];
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages, typing, expanded]);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    if (e.dataTransfer.files.length) setIncoming({ atts: filesToAttachments(e.dataTransfer.files), nonce: Date.now() });
  };

  return (
    <aside
      className={`${styles.dock} ${expanded ? styles.open : styles.closed}`}
      aria-label={`${ASSISTANT_NAME}, conseil devis`}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrag(false); }}
      onDrop={onDrop}
    >
      {/* État réduit : bulle du dernier message, tronquée */}
      <button type="button" className={styles.peek} onClick={() => onExpandedChange(true)} aria-expanded={expanded} tabIndex={expanded ? -1 : 0}>
        <span className={styles.avatar}>{ASSISTANT_NAME[0]}</span>
        <span className={styles.peekText}>
          <b>{last?.role === 'user' ? 'Vous' : ASSISTANT_NAME}</b>
          <span>{typing ? 'écrit…' : last?.text || 'Pièce jointe envoyée'}</span>
        </span>
        <span className={styles.peekExpand}><Icon name="expand" size={16} /></span>
      </button>

      {/* État étiré */}
      <div className={styles.panel} aria-hidden={!expanded}>
        <header className={styles.head}>
          <span className={styles.avatar}>{ASSISTANT_NAME[0]}</span>
          <div>
            <h2>{ASSISTANT_NAME}</h2>
            <p>Conseil devis</p>
          </div>
          <button type="button" className={styles.headPreview} onClick={onPreview} title="Voir la pièce en grand, la retoucher et passer au devis">
            <Icon name="eye" size={16} /> Prévisualiser
          </button>
          <button type="button" className={styles.iconBtn} aria-label="Réduire" onClick={() => onExpandedChange(false)}>
            <Icon name="collapse" size={18} />
          </button>
        </header>

        <div ref={listRef} className={styles.list}>
          {messages.map((m) => <Bubble key={m.id} m={m} onEdit={onEditMessage} />)}
          {typing && <Typing label={workLabel} />}
          {!typing && <Choices m={lastAssistant === last ? lastAssistant : undefined} onChoice={onChoice} />}
        </div>

        {/* Étapes de la description : faites (cochées) ou à préciser ; un clic y revient pour modifier. */}
        <nav className={styles.steps} aria-label="Informations de la pièce">
          {steps.map((s) => (
            <button key={s.field} type="button" className={s.done ? styles.stepDone : styles.stepTodo} onClick={() => onStep(s.field)} title={s.done ? `Modifier : ${s.label.toLowerCase()}` : `À préciser : ${s.label.toLowerCase()}`}>
              {s.done ? <Icon name="check" size={12} /> : <i />}
              {s.label}
            </button>
          ))}
        </nav>

        {/* Zone de dépôt : glisser-déposer, ou clic pour choisir des fichiers (ils rejoignent la saisie). */}
        <button type="button" className={`${styles.drop} ${drag ? styles.dropOn : ''}`} onClick={() => dropInput.current?.click()} title="Choisir des fichiers à joindre">
          <Icon name="image" size={20} />
          <span>Déposez ou choisissez photos, plans, DXF, STEP</span>
        </button>
        <input ref={dropInput} type="file" multiple accept={ACCEPT} hidden onChange={(e) => { if (e.target.files?.length) setIncoming({ atts: filesToAttachments(e.target.files), nonce: Date.now() }); e.target.value = ''; }} />

        <Composer onSend={onSend} prefill={prefill} context={context} incoming={incoming} />
      </div>
    </aside>
  );
}
