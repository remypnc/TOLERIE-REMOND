import { useEffect, useMemo, useRef, useState } from 'react';
import type { AssistantTurn, Attachment, ChatMessage, Choice, Cut, Edge, Face, Fillet, Hardware, MissingField, PartSpec, ProductSpec } from './lib/types';
import { attachmentFiles, importCad, importedFlat, IMPORTABLE } from './lib/cadImport';
import { aiAvailable, askAi } from './lib/ai';
import { HARDWARE_LABEL, hardwareCode, preHole } from './lib/hardware';
import type { ClientOrder } from './lib/orders';
import { answeredBy, examplesTurn, FIELD_LABELS, fieldQuestion, initialSpec, missingFields, respond, welcomeMessage } from './lib/assistant';
import { unfold } from './lib/sheetmetal';
import { nest } from './lib/nesting';
import { computeQuote, type Delivery } from './lib/pricing';
import { MATERIALS } from './lib/catalog';
import { renderSnapshot } from './lib/snapshot';
import { backend, loadClient, localBackend, newReference, NotLoggedIn, saveClient, type Account, type AdminOrder, type ClientContact, type SubmitResult } from './lib/api';
import { REGION_LABEL } from './lib/partGeometry';
import { FACE_LABEL, faceAxes, faceCorners, faceList, faceSize, filletAnchor, filletPoint, filletsOn, removedPolygon, snapToFace } from './lib/faces';
import { productFlat, productModel, productQuote, PRODUCTS, type Mechanism } from './lib/products';
import { CutPanel } from './components/CutPanel';
import { FilletPanel } from './components/FilletPanel';
import { InsertPanel } from './components/InsertPanel';
import { FacePanel, ProductPanel } from './components/SelectPanel';
import { Viewer3D, type Measure, type LabelKey, type PartEdit, type PickEvent, type Section, type Tag, type ViewerHandle, type ViewName } from './components/Viewer3D';
import { ChatDock, Bubble, Choices, Composer, Typing, filesToAttachments, type ComposerContext, type Step } from './components/Chat';
import { droppedFiles, hasFiles } from './lib/dropFiles';
import { deleteSaved, listSaved, saveQuote, type SavedQuote } from './lib/savedQuotes';
import { FlatPanel } from './components/FlatPanel';
import { QuoteCard, type QuoteCardHandle } from './components/QuoteCard';
import { ContactModal } from './components/ContactModal';
import { AccountPage } from './components/AccountPage';
import { AdminPage } from './components/AdminPage';
import { VersionsButton } from './components/VersionsButton';
import { DownloadMenu } from './components/DownloadMenu';
import { ColorPicker } from './components/ColorPicker';
import { sameGeometry, versionLabel, type PartVersion } from './lib/recap';
import { Icon, LOGO_URL, ViewCubeIcon } from './components/Icons';
import styles from './App.module.css';

type Stage = 'config' | 'preview' | 'quote' | 'sent' | 'account' | 'admin';
type Tool = 'select' | 'dims' | 'bend' | 'drill' | 'insert' | 'cut' | 'round' | 'finish' | 'note';

const VIEWS: { id: ViewName; label: string }[] = [
  { id: 'iso', label: '3/4' },
  { id: 'face', label: 'Face' },
  { id: 'droite', label: 'Droite' },
  { id: 'gauche', label: 'Gauche' },
  { id: 'dessus', label: 'Dessus' },
  { id: 'dessous', label: 'Dessous' },
  { id: 'arriere', label: 'Arrière' },
];

const TOOLS: { id: Tool; label: string; icon: Parameters<typeof Icon>[0]['name'] }[] = [
  { id: 'select', label: 'Sélectionner une face ou un panneau', icon: 'cursor' },
  { id: 'dims', label: 'Modifier une cote', icon: 'resize' },
  { id: 'bend', label: 'Modifier un pli', icon: 'bend' },
  { id: 'drill', label: 'Ajouter un perçage', icon: 'drill' },
  { id: 'insert', label: 'Goujon, écrou à sertir ou taraudage', icon: 'nut' },
  { id: 'cut', label: 'Découper entre deux points', icon: 'cut' },
  { id: 'round', label: 'Arrondir un angle', icon: 'round' },
  { id: 'finish', label: 'Matière et finition', icon: 'palette' },
  { id: 'note', label: 'Annoter', icon: 'note' },
];

/** Produit assemblé : seuls ces outils ont un sens (le reste se règle dans le panneau du produit). */
const PRODUCT_TOOLS: Tool[] = ['select', 'dims', 'finish', 'note'];

const SECTION_AXES: { id: Section['axis']; label: string }[] = [
  { id: 'z', label: 'Face' },
  { id: 'x', label: 'Côté' },
  { id: 'y', label: 'Dessus' },
];

/** Vues secondaires, masquées sur petit écran. */
const MINOR_VIEWS: ViewName[] = ['gauche', 'dessous', 'arriere'];

const eur = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
const msg = (role: ChatMessage['role'], text: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({ id: crypto.randomUUID(), role, text, ...extra });

export default function App() {
  const [spec, setSpecRaw] = useState<PartSpec>(initialSpec);
  // Historique des modifications de la pièce : bouton « Annuler » et Ctrl/Cmd+Z.
  const past = useRef<PartSpec[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  // Version courante tenue à jour immédiatement, pour enchaîner plusieurs modifications dans le même tour.
  const specRef = useRef(spec);
  const setSpec = (next: PartSpec | ((s: PartSpec) => PartSpec)) => {
    const cur = specRef.current;
    const value = typeof next === 'function' ? next(cur) : next;
    if (value === cur) return;
    past.current = [...past.current.slice(-49), cur];
    specRef.current = value;
    setSpecRaw(value);
    setCanUndo(true);
  };
  const undo = () => {
    const prev = past.current.pop();
    if (!prev) return;
    specRef.current = prev;
    setSpecRaw(prev);
    setCanUndo(past.current.length > 0);
    setMessages((m) => [...m, msg('assistant', 'Dernière modification annulée.')]);
  };
  // Versions de la pièce : une nouvelle version dès que la géométrie change (réponse de l'assistant,
  // ou quelques instants après une modification directe sur la 3D). On peut revenir à n'importe laquelle.
  const [versions, setVersions] = useState<PartVersion[]>(() => [{ n: 1, at: new Date().toISOString(), label: 'Pièce de départ', spec }]);
  const versionsRef = useRef(versions);
  // Version dont part la modification en cours (la dernière créée, ou celle vers laquelle on est revenu).
  const baseVersion = useRef(1);
  /** Enregistre `next` comme nouvelle version si sa géométrie est nouvelle ; renvoie son numéro. */
  const commitVersion = (next: PartSpec, label?: string): number => {
    const list = versionsRef.current;
    const same = list.find((v) => sameGeometry(v.spec, next));
    if (same) {
      baseVersion.current = same.n;
      return same.n;
    }
    const last = list[list.length - 1];
    const base = list.find((x) => x.n === baseVersion.current) ?? last;
    const v: PartVersion = { n: last.n + 1, at: new Date().toISOString(), label: label ?? versionLabel(base.spec, next), spec: next };
    baseVersion.current = v.n;
    versionsRef.current = [...list, v];
    setVersions(versionsRef.current);
    return v.n;
  };
  const resetVersions = (base: PartSpec, label: string) => {
    versionsRef.current = [{ n: 1, at: new Date().toISOString(), label, spec: base }];
    baseVersion.current = 1;
    setVersions(versionsRef.current);
  };
  useEffect(() => {
    const id = window.setTimeout(() => commitVersion(spec), 1200);
    return () => window.clearTimeout(id);
  }, [spec]); // eslint-disable-line react-hooks/exhaustive-deps
  const currentVersion = versions.find((v) => sameGeometry(v.spec, spec))?.n ?? null;
  const restoreVersion = (v: PartVersion) => {
    baseVersion.current = v.n;
    setSpec({ ...v.spec, quantity: specRef.current.quantity });
    setMessages((m) => [...m, msg('assistant', `Retour à la version ${v.n} (${v.label}). Vous pouvez annuler ce retour à tout moment.`, { recap: { version: v.n, spec: { ...v.spec, quantity: specRef.current.quantity } } })]);
  };
  const [messages, setMessages] = useState<ChatMessage[]>(() => [welcomeMessage()]);
  const [answered, setAnswered] = useState<MissingField[]>([]);
  const [typing, setTyping] = useState(false);
  // Libellé de la barre de chargement pendant un long traitement (IA, lecture d'un fichier 3D).
  const [work, setWork] = useState<string>();
  // En dev, #devis ouvre directement l'étape devis (pratique pour régler l'animation).
  const [stage, setStage] = useState<Stage>(() => (import.meta.env.DEV && location.hash === '#devis' ? 'quote' : 'config'));
  const [dockOpen, setDockOpen] = useState(true);
  // Premier écran : barre de saisie centrée en bas avec le message d'accueil ; dès le premier message, la fenêtre de discussion.
  const [started, setStarted] = useState(false);
  const [showDims, setShowDims] = useState(false);
  const [flatOn, setFlatOn] = useState(false);
  const [unfolded, setUnfolded] = useState(false);
  const [tool, setTool] = useState<Tool | null>(null);
  const [prefill, setPrefill] = useState<{ text: string; nonce: number }>();
  const [reference, setReference] = useState(newReference);
  // Référence d'une pièce déjà envoyée que le client est en train de modifier (même référence, nouvelle version).
  const [editingRef, setEditingRef] = useState<string | null>(null);
  const [images, setImages] = useState<{ day: string; night: string } | null>(null);
  const [sending, setSending] = useState(false);
  // Espace client : coordonnées pour recevoir le devis (mémorisées sur l'appareil si le client le veut).
  const [contactFor, setContactFor] = useState<'send' | 'profile' | 'login' | null>(null);
  const [loginInfo, setLoginInfo] = useState<string>();
  // Test sans SMTP : lien de connexion renvoyé par le serveur, proposé directement dans la page.
  const [devLink, setDevLink] = useState<string>();
  const [sent, setSent] = useState<SubmitResult | null>(null);
  const [orders, setOrders] = useState<ClientOrder[] | null>(null);
  const viewer = useRef<ViewerHandle>(null);
  const quoteCard = useRef<QuoteCardHandle>(null);

  // Calculs métier, en direct.
  const flat = useMemo(() => (spec.product ? productFlat(spec) : spec.imported ? importedFlat(spec) : unfold(spec)), [spec]);
  const nesting = useMemo(() => nest(flat, spec.quantity, MATERIALS[spec.material], spec.thickness), [flat, spec.quantity, spec.material, spec.thickness]);
  // Le transport dépend de l'adresse de livraison du client (ou du retrait à l'atelier).
  const [client, setClient] = useState<ClientContact | null>(loadClient);
  const priceFor = (d: Delivery | null | undefined) => (spec.product ? productQuote(spec, undefined, d ?? undefined) : computeQuote(spec, flat, undefined, d ?? undefined));
  const quote = useMemo(() => priceFor(client), [spec, flat, client]); // eslint-disable-line react-hooks/exhaustive-deps
  const missing = useMemo(() => missingFields(spec, answered).map((f) => FIELD_LABELS[f]), [spec, answered]);
  // Étapes de la description, cochées une fois renseignées ; ailes et perçages n'ont pas de sens pour un produit assemblé.
  const steps = useMemo<Step[]>(() => {
    const todo = missingFields(spec, answered);
    const fields: MissingField[] = spec.product || spec.imported
      ? ['shape', 'dimensions', 'material', 'thickness', 'finish', 'quantity']
      : ['shape', 'dimensions', ...(spec.flanges.length ? (['flanges'] as MissingField[]) : []), 'material', 'thickness', 'holes', 'finish', 'quantity'];
    return fields.map((f) => ({ field: f, label: FIELD_LABELS[f], done: !todo.includes(f) }));
  }, [spec, answered]);
  /** Étape cliquée : la question correspondante revient, avec ses réponses rapides, pour modifier l'information. */
  const onStep = (f: MissingField) => {
    setStarted(true);
    setDockOpen(true);
    setMessages((m) => [...m, fieldQuestion(specRef.current, f)]);
  };

  // --- Conversation -------------------------------------------------------
  const ctxRef = useRef({ spec, history: messages, answered });
  ctxRef.current = { spec, history: messages, answered };

  const ask = (text: string, attachments: Attachment[] = [], display?: string) => {
    if (text === '__preview__') return goPreview();
    const holeChoice = /^__hole:(.+):([\d.]+)$/.exec(text);
    if (holeChoice) {
      setMessages((m) => [...m, msg('user', display ?? `Ø${holeChoice[2]}`)]);
      return setHoleDiameter(holeChoice[1], Number(holeChoice[2]));
    }
    // Exemples (« Voir plus ») : simple page suivante, sans bulle du client.
    if (text.startsWith('__examples__')) {
      setStarted(true);
      return setMessages((m) => [...m, ...(display && text === '__examples__' ? [msg('user', display)] : []), examplesTurn(Number(text.split(':')[1] ?? 0))]);
    }
    const user = msg('user', display ?? text, { ...(attachments.length ? { attachments } : {}), snapshot: { spec: specRef.current, answered: ctxRef.current.answered } });
    // Le texte proposé (message à corriger, zone touchée) a servi : il ne doit pas réapparaître dans une autre saisie.
    setPrefill(undefined);
    // Idem pour les fichiers déposés sur la page : envoyés avec ce message, ils ne doivent pas revenir dans une autre saisie.
    setDropped(undefined);
    setStarted(true);
    setMessages((m) => [...m, user]);
    setTyping(true);
    void think(user, text, attachments).finally(() => {
      setWork(undefined);
      setTyping(false);
    });
  };
  /** Applique la modification d'un tour et répond avec la fiche de la nouvelle version si la pièce a changé. */
  const applyTurn = (turn: AssistantTurn, done: MissingField[]) => {
    const before = specRef.current;
    const next = { ...before, ...turn.patch };
    setSpec(next);
    setAnswered((a) => [...new Set([...a, ...done])]);
    const changed = !sameGeometry(before, next) || before.quantity !== next.quantity;
    const recap = changed ? { version: commitVersion(next), spec: next } : undefined;
    setMessages((m) => [...m, recap ? { ...turn.message, recap } : turn.message]);
  };
  /** Un tour : import des fichiers 3D joints, puis l'IA si elle est branchée, sinon le moteur de règles. */
  async function think(user: ChatMessage, text: string, attachments: Attachment[]) {
    let rest = attachments;
    const cad = attachments.map((a) => ({ a, f: attachmentFiles.get(a.id) })).find((x) => x.f && IMPORTABLE.test(x.f.name));
    if (cad?.f) {
      setWork('Lecture du fichier 3D…');
      try {
        const im = await importCad(cad.f, specRef.current.thickness);
        const s0 = specRef.current;
        const list = MATERIALS[s0.material].thicknesses;
        const t = im.thickness >= 0.5 && im.thickness <= 10 ? list.reduce((b, x) => (Math.abs(x - im.thickness) < Math.abs(b - im.thickness) ? x : b), list[0]) : s0.thickness;
        const [a, b] = [...im.size].sort((x, y) => y - x);
        const turn: AssistantTurn = {
          patch: { name: im.name.replace(/\.[^.]+$/, ''), imported: im, product: undefined, flanges: [], holes: [], cuts: [], fillets: [], width: a, depth: b, thickness: t, cad: { ...s0.cad, provided: true } },
          missing: [],
          message: msg('assistant',
            `Votre fichier ${im.name} est importé en 3D : encombrement ${im.size.map(fmt).join(' × ')} mm` +
            (im.profile ? `, profil plat de ${fmt(im.profile.cut / 1000)} m de découpe et ${im.profile.pierces - 1} perçage${im.profile.pierces > 2 ? 's' : ''}` : `, épaisseur estimée ${fmt(im.thickness)} mm (retenue : ${fmt(t)} mm), environ ${im.bends} pli${im.bends > 1 ? 's' : ''}`) +
            '. Le prix est estimé à partir du modèle ; la conception CAO est remplacée par une simple reprise de vos fichiers. Quelle matière et quelle quantité ?',
            { choices: [{ label: 'Acier', value: 'en acier' }, { label: 'Inox 304', value: 'en inox 304' }, { label: 'Aluminium', value: 'en aluminium' }, { label: '10 pièces', value: '10 pièces' }], allowCustom: true }),
        };
        applyTurn(turn, ['shape', 'dimensions', 'flanges', 'holes', ...(im.profile ? [] : (['thickness'] as MissingField[]))]);
        rest = attachments.filter((x) => x !== cad.a);
        if (!text.trim() && !rest.length) return;
      } catch (e) {
        setMessages((m) => [...m, msg('assistant', `Je n'ai pas pu lire ${cad.f!.name} : ${(e as Error).message} Un technicien l'ouvrira de son côté ; décrivez-moi la pièce en attendant.`)]);
        if (!text.trim()) return;
      }
    }
    const ctx = { spec: specRef.current, history: [...ctxRef.current.history, user], answered: ctxRef.current.answered };
    if (text.trim() && (await aiAvailable())) {
      setWork('L’IA prépare votre pièce…');
      const ai = await askAi(ctx.spec, ctx.history, ctx.answered, text);
      if (ai) return applyTurn(ai.turn, ai.answered);
    }
    await new Promise((r) => window.setTimeout(r, 450 + Math.random() * 350));
    const turn = respond(ctx, text, rest);
    applyTurn(turn, answeredBy(ctx, text, turn));
  }
  const onChoice = (c: Choice) => ask(c.value, [], c.label);

  // --- Glisser-déposer partout dans la page (dès l'accueil) : fichiers et dossiers rejoignent la saisie ---------
  const [dropping, setDropping] = useState(false);
  const [dropped, setDropped] = useState<{ atts: Attachment[]; nonce: number }>();
  useEffect(() => {
    let depth = 0;
    const enter = (e: DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return;
      e.preventDefault();
      depth++;
      setDropping(true);
    };
    const over = (e: DragEvent) => hasFiles(e.dataTransfer) && e.preventDefault();
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (!depth) setDropping(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return;
      e.preventDefault();
      depth = 0;
      setDropping(false);
      void droppedFiles(e.dataTransfer!).then((files) => {
        if (!files.length) return;
        setDropped({ atts: filesToAttachments(files), nonce: Date.now() });
        if (stage !== 'config' && stage !== 'preview') return;
        setDockOpen(true);
      });
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, [stage]);
  /**
   * Modifier un message déjà envoyé : la conversation repart de juste avant lui, la pièce et les réponses
   * reviennent à cet état (annulable), et son texte revient dans la saisie pour être corrigé puis renvoyé.
   */
  const editMessage = (m: ChatMessage) => {
    if (!m.snapshot || typing) return;
    const snap = m.snapshot;
    setMessages((list) => list.slice(0, Math.max(1, list.findIndex((x) => x.id === m.id))));
    setSpec(snap.spec);
    setAnswered(snap.answered);
    setPrefill({ text: m.text, nonce: Date.now() });
  };

  // --- Navigation ---------------------------------------------------------
  function goPreview() {
    setStage('preview');
    setFlatOn(false);
    setUnfolded(false);
    setTool(null);
    window.setTimeout(() => viewer.current?.setView('iso'), 60);
  }
  const backToConfig = () => {
    setStage('config');
    setDockOpen(true);
    setTool(null);
  };
  const goQuote = () => {
    setImages(null);
    setStage('quote');
  };

  // Images de la carte devis (rendu hors écran) au passage à l'étape devis.
  useEffect(() => {
    if (stage !== 'quote') return;
    const id = window.setTimeout(() => {
      const w = 430, h = 600;
      setImages({ day: renderSnapshot(spec, 'day', w, h), night: renderSnapshot(spec, 'night', w, h) });
    }, 60);
    return () => window.clearTimeout(id);
    // Seulement à l'entrée sur l'étape : un changement de quantité ne change pas l'image.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  const send = async (contact: ClientContact, remember: boolean) => {
    setSending(true);
    setLoginInfo(undefined);
    setClient(contact);
    saveClient(remember ? contact : null);
    try {
      const thumbnail = renderSnapshot(spec, 'day', 320, 240, 1);
      const result = await backend.submitQuote({
        reference,
        replaces: editingRef ?? undefined,
        contact,
        createdAt: new Date().toISOString(),
        spec,
        // Prix recalculé avec l'adresse saisie à l'instant (le transport en dépend).
        quote: priceFor(contact),
        missing,
        conversation: messages,
        thumbnail,
      });
      setSent(result);
      // Envoyé : le brouillon enregistré n'a plus lieu d'être.
      setSaved(deleteSaved(reference));
      setReference(result.order.reference);
      setContactFor(null);
      setStage('sent');
      // Sans serveur, l'e-mail tapé suffit à ouvrir l'espace ; avec serveur, il faut le lien reçu par e-mail.
      if (backend.kind === 'local') setAccount(contact);
    } catch (e) {
      setLoginInfo(e instanceof NotLoggedIn
        ? 'Votre session a expiré : reconnectez-vous depuis « Mon espace » pour envoyer cette modification.'
        : 'L’envoi a échoué. Vérifiez votre connexion puis réessayez : rien n’est perdu.');
    } finally {
      setSending(false);
    }
  };
  const saveProfile = async (contact: ClientContact, remember: boolean) => {
    setClient(contact);
    saveClient(remember ? contact : null);
    await backend.updateProfile(contact).catch(() => undefined);
    setAccount((a) => (a ? { ...a, ...contact } : a));
    setContactFor(null);
  };
  const login = async (contact: ClientContact, remember: boolean) => {
    setSending(true);
    setLoginInfo(undefined);
    try {
      const { linkSent, devLink: link } = await backend.requestAccess(contact.email);
      // Coordonnées gardées ici (prix du transport tout de suite) ; envoyées au serveur une fois connecté.
      const merged = { ...(client ?? {}), ...contact };
      saveClient(remember ? merged : null);
      setClient(merged);
      setDevLink(link);
      if (linkSent) return setLoginInfo(`C’est envoyé : ouvrez le lien reçu à ${contact.email} pour accéder à vos pièces. Il est valable 30 minutes.`);
      // Sans serveur : accès direct aux pièces enregistrées dans ce navigateur.
      setClient(contact);
      setAccount(contact);
      setContactFor(null);
      openAccount();
    } catch {
      setLoginInfo('Impossible d’envoyer le lien pour le moment. Réessayez dans quelques minutes.');
    } finally {
      setSending(false);
    }
  };

  // --- Espace client ---------------------------------------------------------------------
  // `account` = client connecté (session serveur) ; `client` = coordonnées mémorisées pour préremplir.
  const [account, setAccount] = useState<Account | null>(null);
  // Compte atelier : outils d'édition et back-office. « Vue client » masque les outils pour voir ce que voit le client.
  const isAdmin = account?.role === 'admin';
  const [clientView, setClientView] = useState(false);
  const canEditPart = isAdmin && !clientView;
  useEffect(() => {
    if (!canEditPart) setTool(null); // eslint-disable-line react-hooks/set-state-in-effect
  }, [canEditPart]);
  const openAccount = () => {
    setTool(null);
    setFlatOn(false);
    setStage('account');
  };
  useEffect(() => {
    // Retour d'un lien de connexion (e-mail) : #mes-pieces ou #lien-expire.
    const hash = window.location.hash;
    void backend.me().then((me) => {
      // Coordonnées saisies avant de recevoir le lien : complétées sur le compte dès la connexion.
      const local = loadClient();
      if (me && local?.email.toLowerCase() === me.email.toLowerCase()) {
        const server = me;
        const keys = ['company', 'name', 'phone', 'address', 'zip', 'city'] as const;
        if (keys.some((k) => local[k] && local[k] !== server[k])) {
          me = { ...server, ...Object.fromEntries(keys.filter((k) => local[k]).map((k) => [k, local[k]])) };
          void backend.updateProfile(me).catch(() => undefined);
        }
        if (local.pickup) me = { ...me, pickup: true };
      }
      setAccount(me);
      if (me) setClient((c) => (c && c.email === me!.email ? { ...me!, ...c } : me));
      if (hash === '#mes-pieces' && me) openAccount();
      if (hash === '#lien-expire') {
        setLoginInfo('Ce lien a expiré ou a déjà servi. Demandez-en un nouveau : il arrive en quelques secondes.');
        setContactFor('login');
      }
      if (hash === '#mes-pieces' || hash === '#lien-expire') history.replaceState(null, '', window.location.pathname);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (stage !== 'account' || !account) return;
    setOrders(null);
    let live = true;
    backend.listOrders(account.email).then(
      (o) => live && setOrders(o),
      (e) => {
        if (!live) return;
        if (e instanceof NotLoggedIn) {
          setAccount(null);
          setStage('config');
          setContactFor('login');
        } else setOrders([]);
      },
    );
    return () => { live = false; };
  }, [stage, account]);
  /** « Mes pièces » : directement si connecté, sinon demande d'un lien de connexion. */
  const goAccount = () => (account ? openAccount() : setContactFor('login'));
  /** Après l'envoi : l'espace client si connecté ; en test sans SMTP, le lien de l'e-mail directement ; sinon un lien par e-mail. */
  const followPiece = () => {
    if (account) return openAccount();
    if (sent?.devLink) return window.location.assign(sent.devLink);
    setLoginInfo(undefined);
    setDevLink(undefined);
    setContactFor('login');
  };
  /** Atelier : ouvre la pièce d'un client dans l'éditeur ; un renvoi en fait une nouvelle version, au nom du client. */
  const editAsAtelier = (o: AdminOrder, contact: ClientContact) => {
    setClientView(false);
    setClient(contact);
    loadOrder(o, false);
  };
  /** Recharge la pièce d'une demande dans l'éditeur : modification (même référence) ou nouvelle commande. */
  const loadOrder = (o: ClientOrder, asNew: boolean) => {
    setStarted(true);
    past.current = [];
    setCanUndo(false);
    specRef.current = o.spec;
    setSpecRaw(o.spec);
    setAnswered(['shape', 'dimensions', 'material', 'thickness', 'flanges', 'holes', 'finish', 'quantity']);
    setReference(asNew ? newReference() : o.reference);
    resetVersions(o.spec, asNew ? `Reprise de ${o.reference}` : `Version envoyée (${o.reference} v${o.revision})`);
    setEditingRef(asNew ? null : o.reference);
    setMessages((m) => [
      ...m,
      msg('assistant', asNew
        ? `Nouvelle commande basée sur « ${o.spec.name} » (${o.reference}). Ajustez la quantité ou la pièce si besoin, puis envoyez la demande.`
        : `Vous modifiez « ${o.spec.name} » (${o.reference}, version ${o.revision}). Changez ce qu’il faut puis renvoyez la demande : elle repassera en vérification.`),
    ]);
    goPreview();
  };
  // --- Devis enregistrés sans envoi (dans ce navigateur) ------------------------------------
  const [saved, setSaved] = useState<SavedQuote[]>(listSaved);
  const [savedOpen, setSavedOpen] = useState(false);
  const [savedNote, setSavedNote] = useState<string>();
  useEffect(() => {
    if (!savedNote) return;
    const id = window.setTimeout(() => setSavedNote(undefined), 4500);
    return () => window.clearTimeout(id);
  }, [savedNote]);
  const saveCurrent = () => {
    const ok = saveQuote({
      reference,
      savedAt: new Date().toISOString(),
      spec,
      answered,
      messages,
      unitPrice: quote.unitPrice,
      subtotal: quote.subtotal,
      thumbnail: renderSnapshot(spec, 'day', 160, 120, 1),
    });
    setSaved(listSaved());
    setSavedNote(ok
      ? `Devis ${reference} enregistré sur cet appareil, sans envoi à l’atelier. Retrouvez-le dans « Mes devis ».`
      : 'Impossible d’enregistrer : le stockage de ce navigateur est plein ou désactivé.');
  };
  /** Reprend un devis enregistré : même référence, conversation et pièce restaurées, retour à l'étape devis. */
  const openSaved = (q: SavedQuote) => {
    setSavedOpen(false);
    setStarted(true);
    past.current = [];
    setCanUndo(false);
    specRef.current = q.spec;
    setSpecRaw(q.spec);
    setAnswered(q.answered);
    setReference(q.reference);
    resetVersions(q.spec, `Devis enregistré (${q.reference})`);
    setEditingRef(null);
    setMessages([...q.messages, msg('assistant', `Devis ${q.reference} repris tel que vous l’aviez enregistré. Modifiez-le ou envoyez-le quand vous voulez.`)]);
    setTool(null);
    setFlatOn(false);
    goQuote();
  };
  const removeSaved = (reference: string) => setSaved(deleteSaved(reference));
  const logout = () => {
    void backend.logout();
    saveClient(null);
    setClient(null);
    setAccount(null);
    setOrders(null);
    setStage('config');
  };

  // --- Édition dans la preview -----------------------------------------------
  // --- Édition directe sur la 3D (étiquettes de cotes, plis, perçages) -------
  const [editRequest, setEditRequest] = useState<{ key: LabelKey; nonce: number } | null>(null);
  const openEditor = (key: LabelKey) => {
    setShowDims(true);
    setUnfolded(false);
    // Laisse le temps aux étiquettes d'apparaître avant d'ouvrir le champ.
    window.setTimeout(() => setEditRequest({ key, nonce: Date.now() }), 60);
  };
  const note = (text: string, extra: Partial<ChatMessage> = {}) => setMessages((m) => [...m, msg('assistant', text, extra)]);
  const fmt = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 1 });

  const applyEdit = (e: PartEdit) => {
    switch (e.kind) {
      case 'height':
      case 'width':
      case 'depth': {
        if (spec.product) {
          const k = e.kind;
          const lim = PRODUCTS[spec.product.kind].limits[k];
          const v = Math.min(lim[1], Math.max(lim[0], e.value));
          setSpec((s) => ({ ...s, product: { ...s.product!, [k]: v }, ...(k === 'height' ? {} : { [k]: v }) }));
          setAnswered((a) => [...new Set([...a, 'dimensions' as const])]);
          note(`${k === 'width' ? 'Largeur' : k === 'depth' ? 'Profondeur' : 'Hauteur'} : ${fmt(v)} mm. L’ensemble et l’estimation sont recalculés.`);
          break;
        }
        if (e.kind === 'height') break;
        const before = spec[e.kind];
        setSpec((s) => ({ ...s, [e.kind]: e.value }));
        setAnswered((a) => [...new Set([...a, 'dimensions' as const])]);
        note(`Cote mise à jour : ${e.kind === 'width' ? 'longueur' : 'largeur'} ${fmt(before)} → ${fmt(e.value)} mm. L’estimation est recalculée.`);
        break;
      }
      case 'flange': {
        const f = spec.flanges[e.index];
        const r0 = spec.innerRadius ?? spec.thickness;
        setSpec((s) => ({
          ...s,
          innerRadius: e.radius !== r0 ? e.radius : s.innerRadius,
          flanges: s.flanges.map((x, i) => (i === e.index ? { ...x, height: e.height, angle: e.angle } : x)),
        }));
        setAnswered((a) => [...new Set([...a, 'flanges' as const])]);
        note(
          `Aile ${f?.edge ?? ''} mise à jour : ${fmt(e.height)} mm, pliée à ${fmt(e.angle)}°.` +
            (e.radius !== r0 ? ` Rayon intérieur de pliage : R${fmt(e.radius)} mm sur tous les plis.` : ''),
        );
        break;
      }
      case 'hole': {
        setSpec((s) => ({ ...s, holes: s.holes.map((h) => (h.id === e.id ? { ...h, x: e.x, y: e.y, diameter: e.diameter } : h)) }));
        setAnswered((a) => [...new Set([...a, 'holes' as const])]);
        note(`Perçage mis à jour : Ø${fmt(e.diameter)} mm à X ${fmt(e.x)} / Y ${fmt(e.y)} mm.`);
        break;
      }
      case 'holeDelete':
        setSpec((s) => ({ ...s, holes: s.holes.filter((h) => h.id !== e.id) }));
        note('Perçage supprimé.');
        break;
      case 'cutOpen':
        openCut(e.id);
        break;
    }
  };

  /** Réponse rapide « Ø8 » sur un perçage précis : « __hole:<id>:<diamètre> ». */
  const setHoleDiameter = (id: string, d: number) => {
    const h = spec.holes.find((x) => x.id === id);
    if (!h) return;
    applyEdit({ kind: 'hole', id, x: h.x, y: h.y, diameter: d });
  };

  // --- Découpes : point A, point B, aperçu, puis Valider (rien n'est coupé avant) ---------
  const [cutA, setCutA] = useState<{ face: Cut['face'] & string; x: number; y: number } | null>(null);
  const [draft, setDraft] = useState<{ cut: Cut; editing: boolean } | null>(null);
  const [measure, setMeasure] = useState<Measure | null>(null);
  useEffect(() => {
    if (tool !== 'cut') {
      setCutA(null);
      setDraft(null);
    }
    // Changer d'outil ferme les éditeurs d'étiquettes (perçages, cotes) et éteint les repères.
    setEditRequest({ key: '__close__', nonce: Date.now() });
    setMeasure(null);
  }, [tool]);
  const openCut = (id: string) => {
    const c = spec.cuts?.find((x) => x.id === id);
    if (!c) return;
    setTool('cut');
    setCutA(null);
    // Le changement d'outil vide le brouillon : on l'ouvre juste après.
    window.setTimeout(() => setDraft({ cut: { ...c }, editing: true }), 0);
  };
  const validateCut = () => {
    if (!draft) return;
    const c = draft.cut;
    setSpec((s) => ({ ...s, cuts: draft.editing ? (s.cuts ?? []).map((x) => (x.id === c.id ? c : x)) : [...(s.cuts ?? []), c] }));
    note(`${draft.editing ? 'Découpe modifiée' : 'Découpe validée'} sur ${FACE_LABEL[c.face ?? 'base'].toLowerCase()}. Flan, chutes et prix sont recalculés.`);
    setDraft(null);
  };
  const deleteCut = (id: string) => {
    setSpec((s) => ({ ...s, cuts: (s.cuts ?? []).filter((c) => c.id !== id) }));
    if (draft?.cut.id === id) setDraft(null);
    note('Découpe supprimée.');
  };
  // Aperçu : la pièce telle qu'elle sera après la découpe, et la zone retirée en rouge.
  const baseSpec = draft?.editing ? { ...spec, cuts: (spec.cuts ?? []).filter((c) => c.id !== draft.cut.id) } : spec;
  const viewSpec = useMemo(() => (draft ? { ...baseSpec, cuts: [...(baseSpec.cuts ?? []), draft.cut] } : spec), [draft, spec]); // eslint-disable-line react-hooks/exhaustive-deps
  // En mode découpe : les découpes déjà faites en grisé pointillé, celle en cours en rouge.
  const ghosts = useMemo(() => {
    if (tool !== 'cut') return [];
    const done = (baseSpec.cuts ?? []).map((c) => ({
      face: c.face ?? 'base',
      poly: removedPolygon({ ...baseSpec, cuts: (baseSpec.cuts ?? []).filter((x) => x.id !== c.id) }, c),
      style: 'done' as const,
    }));
    return draft ? [...done, { face: draft.cut.face ?? 'base', poly: removedPolygon(baseSpec, draft.cut), style: 'draft' as const }] : done;
  }, [draft, spec, tool]); // eslint-disable-line react-hooks/exhaustive-deps
  const cutTags = useMemo(
    () =>
      tool === 'cut'
        ? (spec.cuts ?? [])
            .map((c, i) => ({ id: c.id, face: c.face ?? 'base', x: (c.x1 + c.x2) / 2, y: (c.y1 + c.y2) / 2, label: `✂ ${i + 1}` }))
            .filter((t) => t.id !== draft?.cut.id)
        : [],
    [spec, tool, draft],
  );

  // --- Arrondis d'angle : toucher un angle « + R » l'arrondit, le rayon se règle dans le panneau ---------
  const [filletSel, setFilletSel] = useState<string | null>(null);
  const [filletRadius, setFilletRadius] = useState(5);
  useEffect(() => {
    if (tool !== 'round') setFilletSel(null);
  }, [tool]);
  const faces: Face[] = ['base', ...spec.flanges.filter((f) => f.height > 0).map((f) => f.edge)];
  /** Angles arrondissables de toute la pièce, avec l'arrondi déjà posé s'il y en a un. */
  const corners = useMemo(
    () =>
      faces.flatMap((face) => {
        const size = faceSize(spec, face)!;
        const fl = filletsOn(spec, face);
        return faceCorners(spec, face).map((c) => ({ face, ...c, fillet: fl.find((f) => Math.hypot(filletPoint(f, size)[0] - c.x, filletPoint(f, size)[1] - c.y) < 1) }));
      }),
    [spec], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const filletTags = useMemo<Tag[]>(() => {
    if (tool !== 'round') return [];
    return corners.map((c) => {
      const size = faceSize(spec, c.face)!;
      // La pastille est posée dans la matière, un peu en retrait de l'angle.
      const off = Math.min(Math.max(c.fillet?.radius ?? 0, Math.min(size[0], size[1]) * 0.1), 24);
      return {
        id: c.fillet ? c.fillet.id : `corner:${c.face}:${c.x}:${c.y}`,
        face: c.face,
        x: c.x + c.inward[0] * off,
        y: c.y + c.inward[1] * off,
        label: c.fillet ? `R${fmt(c.fillet.radius)}` : '+ R',
        title: c.fillet ? 'Régler ou supprimer cet arrondi' : 'Arrondir cet angle',
        tone: c.fillet ? (c.fillet.id === filletSel ? 'sel' : 'on') : 'add',
      };
    });
  }, [corners, tool, filletSel]); // eslint-disable-line react-hooks/exhaustive-deps
  const addFillet = (face: Face, x: number, y: number) => {
    const f: Fillet = { id: crypto.randomUUID(), face, radius: filletRadius, ...filletAnchor(faceSize(spec, face)!, [x, y]) };
    setSpec((s) => ({ ...s, fillets: [...(s.fillets ?? []), f] }));
    setFilletSel(f.id);
  };
  const onFilletTag = (id: string) => {
    const m = /^corner:([a-z]+):([-\d.e]+):([-\d.e]+)$/.exec(id);
    if (m) return addFillet(m[1] as Face, Number(m[2]), Number(m[3]));
    setFilletSel((cur) => (cur === id ? null : id));
  };
  const setFilletRadiusAll = (r: number) => {
    setFilletRadius(r);
    if (filletSel) setSpec((s) => ({ ...s, fillets: (s.fillets ?? []).map((f) => (f.id === filletSel ? { ...f, radius: r } : f)) }));
  };
  const roundAll = () => {
    const todo = corners.filter((c) => !c.fillet);
    const r = filletSel ? (spec.fillets?.find((f) => f.id === filletSel)?.radius ?? filletRadius) : filletRadius;
    setSpec((s) => ({
      ...s,
      fillets: [
        ...(s.fillets ?? []).map((f) => ({ ...f, radius: r })),
        ...todo.map((c) => ({ id: crypto.randomUUID(), face: c.face, radius: r, ...filletAnchor(faceSize(s, c.face)!, [c.x, c.y]) })),
      ],
    }));
    setFilletSel(null);
    note(`Tous les angles libres sont arrondis à R${fmt(r)} mm (les angles sur une ligne de pli restent vifs). Flan et prix recalculés.`);
  };
  const deleteFillet = (id: string) => {
    setSpec((s) => ({ ...s, fillets: (s.fillets ?? []).filter((f) => f.id !== id) }));
    setFilletSel(null);
  };

  // --- Goujonnage, sertissage, taraudage : toucher un perçage l'équipe, toucher la pièce en crée un équipé ---------
  const [insertSel, setInsertSel] = useState<string | null>(null);
  const [insertChoice, setInsertChoice] = useState<Hardware>({ kind: 'ecrou', thread: 'M4' });
  useEffect(() => {
    if (tool !== 'insert') setInsertSel(null);
  }, [tool]);
  const equip = (id: string, hw: Hardware | undefined) =>
    setSpec((s) => ({ ...s, holes: s.holes.map((h) => (h.id === id ? { ...h, hardware: hw, diameter: hw ? preHole(hw).hole : h.diameter } : h)) }));
  const insertTags = useMemo<Tag[]>(
    () =>
      tool === 'insert'
        ? spec.holes.map((h) => ({
            id: h.id,
            face: h.face ?? 'base',
            x: h.x,
            y: h.y,
            label: h.hardware ? hardwareCode(h.hardware) : '+ insert',
            title: h.hardware ? `${HARDWARE_LABEL[h.hardware.kind]} ${h.hardware.thread} : régler ou retirer` : 'Équiper ce perçage',
            tone: h.id === insertSel ? 'sel' : h.hardware ? 'on' : 'add',
          }))
        : [],
    [spec.holes, tool, insertSel],
  );
  const onInsertTag = (id: string) => {
    const h = spec.holes.find((x) => x.id === id);
    if (!h) return;
    if (!h.hardware) {
      equip(id, insertChoice);
      note(`${HARDWARE_LABEL[insertChoice.kind]} ${insertChoice.thread} posé : trou de préparation Ø${fmt(preHole(insertChoice).hole)} mm.`);
    }
    setInsertSel(id);
  };
  const chooseInsert = (hw: Hardware) => {
    setInsertChoice(hw);
    if (insertSel) equip(insertSel, hw);
  };

  // --- Sélection : une face numérotée (pièce pliée) ou un panneau (produit assemblé) devient l'élément à éditer ---------
  const [selFace, setSelFace] = useState<Face | null>(null);
  const [selPanel, setSelPanel] = useState<string | null>(null);
  useEffect(() => {
    if (tool !== 'select') {
      setSelFace(null);
      setSelPanel(null);
    }
  }, [tool]);
  const numbered = useMemo(() => faceList(spec), [spec]);
  const faceTags = useMemo<Tag[]>(
    () =>
      tool === 'select' && !spec.product && !spec.imported
        ? numbered.map((f) => {
            const [w, h] = faceSize(spec, f.face) ?? [spec.width, spec.depth];
            return { id: f.face, face: f.face, x: w / 2, y: h / 2, label: String(f.n), title: `Face ${f.n} · ${f.label}`, tone: f.face === selFace ? 'sel' : 'on' };
          })
        : [],
    [numbered, tool, selFace, spec],
  );
  const selectedRegion = tool !== 'select' ? null : selPanel ? (`panel:${selPanel}` as const) : selFace ? (selFace === 'base' ? 'base' : (`aile-${selFace}` as const)) : null;
  const setFlange = (edge: Edge, add: boolean) => {
    if (add) {
      setSpec((s) => ({ ...s, flanges: [...s.flanges.filter((f) => f.edge !== edge), { edge, height: 40, angle: 90 }] }));
      setSelFace(edge);
      note(`Aile ${FACE_LABEL[edge].replace(/^Aile /, '').toLowerCase()} ajoutée : 40 mm à 90°. Réglez sa hauteur dans le panneau de la face.`);
    } else {
      setSpec((s) => ({ ...s, flanges: s.flanges.filter((f) => f.edge !== edge), holes: s.holes.filter((h) => (h.face ?? 'base') !== edge) }));
      setSelFace('base');
      note(`${FACE_LABEL[edge]} supprimée, avec ses perçages.`);
    }
  };
  const setProduct = (p: ProductSpec) => setSpec((s) => ({ ...s, product: p, width: p.width, depth: p.depth }));

  // --- Produit assemblé : ouvrants (portes, trappes, tiroirs, rideau) et mise en marche, pour tout le monde -----------
  const model = useMemo(() => (spec.product ? productModel(spec.product, spec.thickness) : null), [spec.product, spec.thickness]);
  const [motionOpen, setMotionOpen] = useState<Record<string, number>>({});
  const [active, setActive] = useState(false);
  const productKind = spec.product?.kind;
  useEffect(() => {
    setMotionOpen({}); // eslint-disable-line react-hooks/set-state-in-effect
    setActive(false);
  }, [productKind]);
  const isOpen = (m: Mechanism) => m.members.length > 0 && m.members.every((id) => (motionOpen[id] ?? 0) > 0.5);
  const toggleMech = (m: Mechanism) => {
    const open = !isOpen(m);
    setMotionOpen((o) => ({ ...o, ...Object.fromEntries(m.members.map((id) => [id, open ? 1 : 0])) }));
  };
  const toggleMotion = (id: string) => setMotionOpen((o) => ({ ...o, [id]: (o[id] ?? 0) > 0.5 ? 0 : 1 }));
  useEffect(() => {
    if ((spec.product || spec.imported) && tool && !PRODUCT_TOOLS.includes(tool)) setTool(null); // eslint-disable-line react-hooks/set-state-in-effect
  }, [spec.product, spec.imported, tool]);

  // Face ou panneau désigné : bulle jointe au-dessus de la saisie, le message lui est adressé.
  const composerContext = useMemo<ComposerContext | null>(() => {
    if (tool !== 'select') return null;
    if (selPanel && model) {
      const i = model.panels.findIndex((x) => x.id === selPanel);
      if (i < 0) return null;
      const label = model.panels[i].label;
      return { label: `Panneau ${i + 1} · ${label}`, prefix: `Panneau ${i + 1} (${label.toLowerCase()}) : `, onClear: () => setSelPanel(null) };
    }
    const f = selFace && numbered.find((x) => x.face === selFace);
    return f ? { label: `Face ${f.n} · ${f.label}`, prefix: `Face ${f.n} (${f.label.toLowerCase()}) : `, onClear: () => setSelFace(null) } : null;
  }, [tool, selPanel, selFace, model, numbered]);

  // --- Couleurs : toute la pièce, ou le panneau désigné (et tout ce que porte son ouvrant) ---
  const [colorOpen, setColorOpen] = useState(false);
  const pickedPanel = tool === 'select' && selPanel && model ? model.panels.find((x) => x.id === selPanel) : undefined;
  const colorKey = pickedPanel ? pickedPanel.motion ?? pickedPanel.id : null;
  const pickColor = (ral: string | null, target: 'all' | 'panel') => {
    if (target === 'panel' && colorKey) {
      setSpec((s) => {
        if (!s.product) return s;
        const colors = { ...(s.product.colors ?? {}) };
        if (ral) colors[colorKey] = ral;
        else delete colors[colorKey];
        return { ...s, product: { ...s.product, colors } };
      });
      note(ral ? `${pickedPanel!.label} : RAL ${ral}.` : `${pickedPanel!.label} : même couleur que la pièce.`);
    } else {
      setSpec((s) => (ral ? { ...s, finish: 'epoxy', ral } : { ...s, finish: 'brut', ral: undefined }));
      setAnswered((a) => [...new Set([...a, 'finish' as const])]);
      note(ral ? `Thermolaquage RAL ${ral} sur toute la pièce. Le prix est recalculé.` : 'Pièce laissée en métal brut, sans peinture.');
    }
  };

  // --- Vue de coupe ---------------------------------------------------------------------------------
  const [section, setSection] = useState<Section | null>(null);

  // Ctrl/Cmd+Z hors des champs de saisie.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea')) return;
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
      }
      if (e.key === 'Escape' && draft) setDraft(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const onPick = (e: PickEvent) => {
    if (e.region.startsWith('panel:')) {
      const id = e.region.slice(6);
      if (tool === 'select') return setSelPanel(id);
      const i = model?.panels.findIndex((x) => x.id === id) ?? -1;
      const label = i >= 0 ? `Panneau ${i + 1} (${model!.panels[i].label.toLowerCase()})` : 'Panneau';
      return setPrefill({ text: tool === 'finish' ? 'Finition : ' : `${label} : `, nonce: Date.now() });
    }
    if (tool === 'select') return setSelFace(e.face);
    const where = REGION_LABEL(e.region);
    const flangeIndex = spec.flanges.findIndex((f) => `aile-${f.edge}` === e.region);
    // Clic sur (ou tout près d') un perçage existant : on l'édite, quel que soit l'outil.
    const near = spec.holes.find((h) => (h.face ?? 'base') === e.face && Math.hypot(h.x - e.x, h.y - e.y) <= h.diameter / 2 + 6);
    if (near && tool === 'insert') return onInsertTag(near.id);
    if (near && tool !== 'note' && tool !== 'cut' && tool !== 'round') return openEditor(`hole:${near.id}`);
    if (tool === 'insert') {
      const hole = { id: crypto.randomUUID(), x: e.x, y: e.y, diameter: preHole(insertChoice).hole, face: e.face, hardware: insertChoice };
      setSpec((s) => ({ ...s, holes: [...s.holes, hole] }));
      setAnswered((a) => [...new Set([...a, 'holes' as const])]);
      setInsertSel(hole.id);
      note(`${HARDWARE_LABEL[insertChoice.kind]} ${insertChoice.thread} ajouté sur ${FACE_LABEL[e.face].toLowerCase()} (X ${e.x}, Y ${e.y}) : trou de préparation Ø${fmt(preHole(insertChoice).hole)} mm.`);
      return;
    }

    if (tool === 'drill') {
      const hole = { id: crypto.randomUUID(), x: e.x, y: e.y, diameter: 10, face: e.face };
      setSpec((s) => ({ ...s, holes: [...s.holes, hole] }));
      setAnswered((a) => [...new Set([...a, 'holes' as const])]);
      const ax = faceAxes(e.face);
      note(`Nouveau perçage Ø10 sur ${FACE_LABEL[e.face].toLowerCase()}, à ${e.x} mm ${ax.x} et ${e.y} mm ${ax.y}. Choisissez son diamètre, ou modifiez-le directement sur la pièce.`, {
        choices: [6, 8, 10, 12, 16].map((d) => ({ label: `Ø${d}`, value: `__hole:${hole.id}:${d}` })),
        allowCustom: true,
      });
      openEditor(`hole:${hole.id}`);
      return;
    }
    if (tool === 'cut') {
      if (draft) return; // une découpe est déjà en préparation : la valider ou l'annuler d'abord
      const [x, y] = snapToFace(spec, e.face, e.x, e.y);
      if (!cutA || cutA.face !== e.face) {
        if (cutA && cutA.face !== e.face) note('Le point B doit être sur la même face que le point A : on repart de ce point.');
        return setCutA({ face: e.face, x, y });
      }
      if (Math.hypot(x - cutA.x, y - cutA.y) < 5) return;
      setDraft({ cut: { id: crypto.randomUUID(), face: e.face, x1: cutA.x, y1: cutA.y, x2: x, y2: y }, editing: false });
      setCutA(null);
      return;
    }
    if (tool === 'round') {
      // Clic sur la pièce : l'angle le plus proche de la face touchée.
      const size = faceSize(spec, e.face)!;
      const best = corners
        .filter((c) => c.face === e.face)
        .map((c) => ({ c, d: Math.hypot(c.x - e.x, c.y - e.y) }))
        .sort((a, b) => a.d - b.d)[0];
      if (!best || best.d > Math.min(size[0], size[1]) * 0.45) return;
      return best.c.fillet ? setFilletSel(best.c.fillet.id) : addFillet(best.c.face, best.c.x, best.c.y);
    }
    if (tool === 'dims' || tool === 'bend') {
      return openEditor(flangeIndex >= 0 ? `flange:${flangeIndex}` : 'width');
    }
    const text =
      tool === 'finish' ? `Finition de la pièce : `
      : tool === 'note' ? `Note sur ${where.toLowerCase()} (X ${e.x}, Y ${e.y}) : `
      : `${where} : `;
    setPrefill({ text, nonce: Date.now() });
  };

  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  const lastIsAssistant = messages[messages.length - 1]?.role === 'assistant';

  const estimate = (
    <div className={styles.estimate} aria-live="polite">
      <span>Estimation indicative</span>
      <strong>{eur(quote.unitPrice)} <small>HT / pc</small></strong>
      <em>{spec.quantity} pc · total {eur(quote.subtotal)} HT</em>
    </div>
  );

  const stepIndex = stage === 'config' ? 0 : stage === 'preview' ? 1 : 2;

  return (
    <main className={`${styles.app} ${styles[stage]} ${dockOpen && started ? styles.dockOpen : ''} ${stage === 'config' && !started ? styles.intro : ''}`}>
      <header className={styles.top}>
        <a href="https://www.tolerie-remond.com/" className={styles.brand}>
          <img src={LOGO_URL} alt="Tôlerie Rémond" />
        </a>
        {stage !== 'account' && stage !== 'admin' && <ol className={styles.steps} aria-label="Étapes">
          {['Décrire', 'Prévisualiser', 'Devis'].map((s, i) => (
            <li key={s} className={i === stepIndex ? styles.stepOn : i < stepIndex ? styles.stepDone : ''}>
              <span>{i < stepIndex ? <Icon name="check" size={12} /> : i + 1}</span>{s}
            </li>
          ))}
        </ol>}
        {stage === 'account' ? (
          <div className={styles.headRight}>
            {isAdmin && (
              <button type="button" className={styles.accountBtn} onClick={() => setStage('admin')} title="Back-office de l’atelier">
                <Icon name="layers" size={18} /><span>Atelier</span>
              </button>
            )}
            <button type="button" className={styles.accountBtn} onClick={() => setStage(editingRef ? 'preview' : 'config')}>
              <Icon name="back" size={18} /><span>Retour au devis</span>
            </button>
          </div>
        ) : (
          <div className={styles.headRight}>
            {isAdmin && (stage === 'config' || stage === 'preview') && (
              <button type="button" className={`${styles.accountBtn} ${styles.iconOnly} ${canEditPart ? styles.editOn : ''}`} onClick={() => setClientView((v) => !v)} aria-pressed={canEditPart}
                title={canEditPart ? 'Outils d’édition atelier affichés : cliquer pour voir comme un client' : 'Vue client : cliquer pour réafficher les outils d’édition'}>
                <Icon name={canEditPart ? 'pencil' : 'eye'} size={18} />
              </button>
            )}
            {isAdmin && (
              <button type="button" className={`${styles.accountBtn} ${stage === 'admin' ? styles.editOn : ''}`} onClick={() => { setTool(null); setStage(stage === 'admin' ? (editingRef ? 'preview' : 'config') : 'admin'); }} title="Back-office de l’atelier">
                <Icon name={stage === 'admin' ? 'back' : 'layers'} size={18} /><span>{stage === 'admin' ? 'Retour au devis' : 'Atelier'}</span>
              </button>
            )}
            {saved.length > 0 && (
              <div className={styles.savedWrap}>
                <button type="button" className={`${styles.accountBtn} ${savedOpen ? styles.editOn : ''}`} onClick={() => setSavedOpen((o) => !o)} aria-expanded={savedOpen} title="Devis enregistrés sur cet appareil">
                  <Icon name="save" size={18} /><span>Mes devis ({saved.length})</span>
                </button>
                {savedOpen && (
                  <div className={styles.savedMenu} role="menu">
                    <p>Enregistrés sur cet appareil, non envoyés à l’atelier.</p>
                    {saved.map((q) => (
                      <div key={q.reference} className={styles.savedItem}>
                        <button type="button" role="menuitem" onClick={() => openSaved(q)}>
                          {q.thumbnail ? <img src={q.thumbnail} alt="" /> : <span className={styles.savedThumb}><Icon name="cube" size={20} /></span>}
                          <span>
                            <b>{q.spec.name}</b>
                            <small>{q.reference} · {new Date(q.savedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small>
                            <small>{q.spec.quantity} pc · {eur(q.unitPrice)} HT / pc</small>
                          </span>
                        </button>
                        <button type="button" className={styles.savedDel} onClick={() => removeSaved(q.reference)} title="Supprimer ce devis enregistré" aria-label={`Supprimer ${q.reference}`}>
                          <Icon name="trash" size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <button type="button" className={styles.accountBtn} onClick={goAccount} title={account ? `Mes pièces · ${account.email}` : 'Retrouver mes pièces et leur suivi'}>
              {account ? <b>{(account.name || account.company || account.email).trim()[0]?.toUpperCase()}</b> : <Icon name="user" size={18} />}
              <span>{account ? 'Mes pièces' : 'Mon espace'}</span>
            </button>
          </div>
        )}
      </header>

      {/* ------------------------- Étapes 1 et 2 : la pièce en 3D ------------------------- */}
      {(stage === 'config' || stage === 'preview') && (
        <>
          <section className={styles.stageArea} aria-label="Pièce en 3D">
            <Viewer3D
              ref={viewer}
              spec={viewSpec}
              fold={unfolded ? 0 : 1}
              showDims={showDims}
              pickable={stage === 'preview' && tool !== null}
              onPick={onPick}
              onEdit={canEditPart ? applyEdit : undefined}
              editRequest={editRequest}
              markers={draft ? [{ face: draft.cut.face ?? 'base', x: draft.cut.x1, y: draft.cut.y1 }, { face: draft.cut.face ?? 'base', x: draft.cut.x2, y: draft.cut.y2 }] : cutA ? [cutA] : []}
              ghosts={ghosts}
              tags={tool === 'round' ? filletTags : tool === 'insert' ? insertTags : tool === 'select' ? faceTags : cutTags}
              onTag={tool === 'round' ? onFilletTag : tool === 'insert' ? onInsertTag : tool === 'select' ? (id) => setSelFace(id as Face) : openCut}
              selected={selectedRegion}
              section={section}
              motions={motionOpen}
              active={active}
              onMotion={toggleMotion}
              measure={draft ? measure : null}
              onMarkerMove={
                draft
                  ? (i, x, y) => {
                      const n = i === 0 ? '1' : '2';
                      setDraft((d) => (d ? { ...d, cut: { ...d.cut, [`x${n}`]: x, [`y${n}`]: y } } : d));
                      setMeasure({ face: draft.cut.face ?? 'base', x, y, axis: 'xy' });
                    }
                  : undefined
              }
            />

            {stage === 'config' && estimate}

            {/* Produit assemblé : ouvrants et mise en marche (aussi en cliquant directement sur une porte). */}
            {model && (model.mechanisms.length > 0 || model.panels.some((x) => x.glow || x.spin)) && (
              <div className={`${styles.mechBar} ${tool === 'select' ? styles.mechShift : ''}`} role="group" aria-label="Mécanismes">
                {model.mechanisms.map((m) => (
                  <button key={m.id} type="button" className={isOpen(m) ? styles.mechOn : ''} onClick={() => toggleMech(m)} aria-pressed={isOpen(m)} title={isOpen(m) ? m.close : m.open}>
                    <Icon name="door" size={17} /><span>{isOpen(m) ? m.close : m.open}</span>
                  </button>
                ))}
                {model.panels.some((x) => x.glow || x.spin) && <button type="button" className={`${styles.mechPower} ${active ? styles.mechOn : ''}`} onClick={() => setActive((a) => !a)} aria-pressed={active} title={active ? 'Arrêter' : PRODUCTS[spec.product!.kind].activeLabel}>
                  <Icon name="power" size={17} /><span>{active ? 'Arrêter' : PRODUCTS[spec.product!.kind].activeLabel}</span>
                </button>}
              </div>
            )}

            {stage === 'config' && flatOn && <FlatPanel flat={flat} nesting={nesting} quantity={spec.quantity} onClose={() => setFlatOn(false)} />}
          </section>

          {/* Barre de vues : icône + légende courte, centrée sur la zone 3D */}
          <nav className={styles.viewBar} aria-label="Affichage">
            <button type="button" className={`${styles.tbIcon} ${showDims ? styles.tbOn : ''}`} onClick={() => setShowDims((v) => !v)} aria-pressed={showDims} title="Afficher et modifier les cotes">
              <Icon name="ruler" size={20} /><small>Cotes</small>
            </button>
            <span className={styles.sep} />
            {VIEWS.map((v) => (
              <button key={v.id} type="button" className={`${styles.tbIcon} ${MINOR_VIEWS.includes(v.id) ? styles.minor : ''}`} onClick={() => viewer.current?.setView(v.id)} title={`Vue ${v.label}`} aria-label={`Vue ${v.label}`}>
                <ViewCubeIcon view={v.id} /><small>{v.label}</small>
              </button>
            ))}
            <span className={styles.sep} />
            <span className={styles.colorWrap}>
              <button type="button" className={`${styles.tbIcon} ${colorOpen ? styles.tbOn : ''}`} onClick={() => setColorOpen((o) => !o)} aria-pressed={colorOpen} title="Couleur de la pièce ou du panneau sélectionné">
                <Icon name="palette" size={20} /><small>Couleur</small>
              </button>
              {colorOpen && (
                <ColorPicker
                  current={spec.finish === 'epoxy' ? spec.ral : undefined}
                  panelLabel={pickedPanel?.label}
                  panelRal={colorKey ? spec.product?.colors?.[colorKey] : undefined}
                  onPick={pickColor}
                  onClose={() => setColorOpen(false)}
                  up={stage === 'config' && started}
                />
              )}
            </span>
            <button type="button" className={`${styles.tbIcon} ${section ? styles.tbOn : ''}`} onClick={() => setSection((x) => (x ? null : { axis: 'z', pos: 0.5 }))} aria-pressed={!!section} title="Vue de coupe : voir l’intérieur">
              <Icon name="section" size={20} /><small>Coupe</small>
            </button>
            {section && (
              <span className={styles.sectionCtl}>
                {SECTION_AXES.map((a) => (
                  <button key={a.id} type="button" className={section.axis === a.id ? styles.sectionOn : ''} onClick={() => setSection({ ...section, axis: a.id })} aria-pressed={section.axis === a.id}>{a.label}</button>
                ))}
                <input type="range" min={0.02} max={0.98} step={0.01} value={section.pos} onChange={(e) => setSection({ ...section, pos: Number(e.target.value) })} aria-label="Position du plan de coupe" />
              </span>
            )}
            {!spec.product && !spec.imported && <button type="button" className={`${styles.tbIcon} ${unfolded ? styles.tbOn : ''}`} onClick={() => setUnfolded((u) => !u)} aria-pressed={unfolded} title={unfolded ? 'Replier la pièce' : 'Déplier la pièce'}>
              <Icon name="unfold" size={20} /><small>{unfolded ? 'Replier' : 'Déplier'}</small>
            </button>}
            {stage === 'config' && !spec.product && !spec.imported && (
              <button type="button" className={`${styles.tbIcon} ${flatOn ? styles.tbOn : ''}`} onClick={() => setFlatOn((f) => !f)} aria-pressed={flatOn} title="Patron déplié et imbrication">
                <Icon name="layers" size={20} /><small>Patron</small>
              </button>
            )}
          </nav>

          {/* Colonne de droite : outils d'édition (preview) puis zoom juste en dessous */}
          <div className={styles.rightRail}>
            {stage === 'preview' && canEditPart && (
              <div className={styles.tools} role="toolbar" aria-label="Que voulez-vous modifier ?">
                {TOOLS.filter((t) => !(spec.product || spec.imported) || PRODUCT_TOOLS.includes(t.id)).map((t) => (
                  <button key={t.id} type="button" className={tool === t.id ? styles.toolOn : ''} onClick={() => setTool((cur) => (cur === t.id ? null : t.id))} aria-pressed={tool === t.id} title={t.label}>
                    <Icon name={t.icon} size={19} />
                    <span className={styles.tip}>{t.label}</span>
                  </button>
                ))}
              </div>
            )}
            <div className={styles.zoomBar} role="group" aria-label="Historique et zoom">
              <VersionsButton versions={versions} current={currentVersion} onRestore={restoreVersion} />
              {canEditPart && <DownloadMenu spec={spec} reference={reference} contact={client ?? undefined} quote={quote} />}
              <button type="button" onClick={undo} disabled={!canUndo} aria-label="Annuler la dernière modification" title="Annuler la dernière modification (Ctrl/Cmd + Z)"><Icon name="undo" /></button>
              <button type="button" onClick={() => viewer.current?.zoom(0.75)} aria-label="Zoomer" title="Zoomer"><Icon name="zoomIn" /></button>
              <button type="button" onClick={() => viewer.current?.zoom(1.33)} aria-label="Dézoomer" title="Dézoomer"><Icon name="zoomOut" /></button>
            </div>
          </div>
        </>
      )}

      {stage === 'config' && !started && (
        <div className={`${styles.previewBar} ${styles.introBar}`}>
          <div className={styles.lastMsg}>
            <Bubble m={messages[0]} />
            <Choices m={messages[0]} onChoice={onChoice} />
          </div>
          <div className={styles.pbComposer}>
            <Composer big onSend={(t, a) => ask(t, a)} prefill={prefill} incoming={dropped} placeholder="Décrivez votre pièce : forme, cotes, matière… ou parlez au micro" />
          </div>
        </div>
      )}

      {stage === 'config' && started && (
        <ChatDock
          messages={messages}
          typing={typing}
          workLabel={work}
          onEditMessage={editMessage}
          onSend={(t, a) => ask(t, a)}
          onChoice={onChoice}
          prefill={prefill}
          expanded={dockOpen}
          onExpandedChange={setDockOpen}
          steps={steps}
          onStep={onStep}
          context={composerContext}
          incomingFromPage={dropped}
          onPreview={goPreview}
        />
      )}

      {/* ------------------------- Étape 2 : preview + édition ------------------------- */}
      {stage === 'preview' && (
        <>
          {tool === 'cut' && draft && (
            <CutPanel
              spec={baseSpec}
              draft={draft?.cut ?? null}
              editing={draft?.editing ?? false}
              onChange={(c) => setDraft((d) => (d ? { ...d, cut: c } : d))}
              onValidate={validateCut}
              onCancel={() => setDraft(null)}
              onDelete={deleteCut}
              onMeasure={setMeasure}
            />
          )}
          {tool === 'round' && (
            <FilletPanel
              selected={spec.fillets?.find((f) => f.id === filletSel) ?? null}
              radius={filletRadius}
              count={spec.fillets?.length ?? 0}
              onRadius={setFilletRadiusAll}
              onAll={roundAll}
              onDelete={deleteFillet}
              onClear={() => {
                setSpec((s) => ({ ...s, fillets: [] }));
                setFilletSel(null);
              }}
              onClose={() => setTool(null)}
            />
          )}
          {tool === 'select' && !spec.product && selFace && (
            <FacePanel
              spec={spec}
              face={selFace}
              onSelect={setSelFace}
              onEdit={applyEdit}
              onFlange={setFlange}
              onTool={setTool}
              onDescribe={() => setPrefill({ text: '', nonce: Date.now() })}
              onClose={() => setSelFace(null)}
            />
          )}
          {tool === 'select' && spec.product && (
            <ProductPanel
              spec={spec}
              panel={selPanel}
              onChange={setProduct}
              onDescribe={() => setPrefill({ text: '', nonce: Date.now() })}
              onClose={() => setTool(null)}
            />
          )}
          {tool === 'insert' && (
            <InsertPanel
              selected={spec.holes.find((h) => h.id === insertSel) ?? null}
              choice={insertChoice}
              thickness={spec.thickness}
              count={spec.holes.filter((h) => h.hardware).length}
              onChoice={chooseInsert}
              onRemove={(id) => setSpec((s) => ({ ...s, holes: s.holes.map((h) => (h.id === id ? { ...h, hardware: undefined } : h)) }))}
              onClose={() => setTool(null)}
            />
          )}
          {tool && (
            <p className={styles.toolHint}>
              {tool === 'cut'
                ? draft
                  ? 'Ajustez les points si besoin, puis validez'
                  : cutA
                    ? 'Point A posé : cliquez le point B sur la même face'
                    : (spec.cuts?.length ?? 0) > 0
                      ? 'Cliquez le point A d’une nouvelle découpe, ou ✂ pour en modifier une'
                      : 'Découpe : cliquez le point A sur une face'
                : tool === 'select'
                  ? spec.product ? 'Touchez un panneau pour le désigner' : selFace ? 'Touchez une autre face pour changer' : 'Touchez une face (ou son numéro) pour la sélectionner'
                : tool === 'round'
                  ? 'Touchez un angle « + R » pour l’arrondir'
                  : tool === 'insert'
                    ? 'Touchez un perçage pour l’équiper, ou la pièce pour poser un insert'
                  : `${TOOLS.find((t) => t.id === tool)!.label} : cliquez sur la pièce`}
            </p>
          )}

          {/* Bas de page : estimation, dernier message, saisie ; la grille empêche tout chevauchement */}
          <div className={styles.previewBar}>
            <div className={styles.pbEstimate}>{estimate}</div>
            <div className={styles.lastMsg}>
              {typing ? <Typing label={work} /> : lastIsAssistant && lastAssistant && <Bubble m={lastAssistant} compact />}
              {!typing && lastIsAssistant && <Choices m={lastAssistant && { ...lastAssistant, choices: lastAssistant.choices?.filter((c) => c.value !== '__preview__') }} onChoice={onChoice} />}
            </div>
            <button type="button" className={`${styles.ghostBtn} ${styles.pbBack}`} onClick={backToConfig}>
              <Icon name="back" size={18} /> <span>Continuer à modifier</span>
            </button>
            <div className={styles.pbComposer}>
              <Composer big onSend={(t, a) => ask(t, a)} prefill={prefill} context={composerContext} incoming={dropped} placeholder="Une modification ? ex. « aile à 50 », « inox »" />
            </div>
            <button type="button" className={`${styles.primaryBtn} ${styles.pbOk}`} onClick={goQuote}>
              <span>Confirmer et voir le devis</span> <Icon name="check" size={18} />
            </button>
          </div>
        </>
      )}

      {/* ------------------------- Étape 3 : devis ------------------------- */}
      {(stage === 'quote' || stage === 'sent') && (
        <>
          <section className={styles.quoteArea}>
            <QuoteCard
              ref={quoteCard}
              spec={spec}
              flat={flat}
              quote={quote}
              reference={reference}
              missing={missing}
              images={images}
              onQuantity={(q) => setSpec((s) => ({ ...s, quantity: q }))}
            />
          </section>
          <div className={styles.quoteActions}>
            <button type="button" className={styles.ghostBtn} onClick={() => void quoteCard.current?.close().then(goPreview)}>
              <Icon name="back" size={18} /> <span>Revoir la pièce et les détails</span>
            </button>
            {!editingRef && (
              <button type="button" className={`${styles.ghostBtn} ${styles.saveBtn}`} onClick={saveCurrent} title="Garder ce devis sur cet appareil sans l’envoyer à l’atelier">
                <Icon name="save" size={18} /> <span>Enregistrer le devis</span>
              </button>
            )}
            <button type="button" className={styles.primaryBtn} onClick={() => setContactFor('send')} disabled={sending}>
              <span>{editingRef ? 'Envoyer la modification' : 'Valider et envoyer en production'}</span> <Icon name="send" size={18} />
            </button>
          </div>
        </>
      )}


      {savedNote && <div className={styles.savedToast} role="status">{savedNote}</div>}

      {stage === 'admin' && account && <AdminPage me={account} onOpenInEditor={editAsAtelier} />}

      {stage === 'account' && account && (
        <AccountPage
          client={account}
          orders={orders}
          onNew={() => window.location.assign(window.location.pathname)}
          onEdit={(o) => loadOrder(o, false)}
          onReorder={(o) => loadOrder(o, true)}
          onProfile={() => setContactFor('profile')}
          onLogout={logout}
          onDemo={import.meta.env.DEV && localBackend ? () => {
            localBackend?.seedDemo(account.email, spec, quote);
            void backend.listOrders(account.email).then(setOrders);
          } : undefined}
        />
      )}

      {stage === 'sent' && (
        <div className={styles.sentBackdrop}>
          <div className={styles.sentCard} role="dialog" aria-modal aria-labelledby="sent-title">
            <span className={styles.sentIcon}><Icon name="check" size={30} /></span>
            <h2 id="sent-title">Demande envoyée</h2>
            <p>Votre demande <b>{reference}</b> est {sent?.stored === 'server' ? 'transmise à l’atelier' : 'enregistrée'}.</p>
            <p>Un technicien vérifie les cotes, la faisabilité et le prix, puis vous envoie le devis définitif sous 48 h ouvrées à <b>{sent?.order.contact.email}</b>.</p>
            <ul className={styles.sentChecks}>
              <li><Icon name="check" size={14} /> Pièce enregistrée dans votre espace{sent?.order.revision && sent.order.revision > 1 ? ` (version ${sent.order.revision})` : ''}</li>
              {sent?.emailSent && <li><Icon name="check" size={14} /> E-mail de confirmation envoyé</li>}
              {sent?.stored === 'server' && <li><Icon name="check" size={14} /> Demande reçue par l’atelier</li>}
            </ul>
            {missing.length > 0 && <p className={styles.sentWarn}>Il nous manque encore : {missing.join(', ')}. Le technicien vous les demandera.</p>}
            {sent?.devLink && (
              <p className={styles.devNote}>
                Mode test : aucun SMTP configuré, donc aucun e-mail réel n’est parti. « Suivre ma pièce » ouvre directement le lien de l’e-mail.{' '}
                <a href="/api/dev/outbox" target="_blank" rel="noreferrer">Voir l’e-mail de confirmation</a>
              </p>
            )}
            <div className={styles.sentActions}>
              <button type="button" className={styles.ghostBtn} onClick={followPiece}>Suivre ma pièce</button>
              <a className={styles.primaryBtn} href="https://www.tolerie-remond.com/">Retour à l’accueil</a>
            </div>
          </div>
        </div>
      )}
      {dropping && (stage === 'config' || stage === 'preview') && (
        <div className={styles.dropOverlay} aria-hidden>
          <div>
            <Icon name="image" size={34} />
            <b>Déposez vos fichiers ici</b>
            <span>Photos, croquis, plans PDF, DXF, STEP… ou un dossier entier</span>
          </div>
        </div>
      )}
      {contactFor && (
        <ContactModal
          key={contactFor}
          mode={contactFor}
          initial={contactFor === 'profile' ? account : client}
          reference={contactFor === 'send' ? reference : undefined}
          submitLabel={contactFor === 'send' ? (editingRef ? 'Envoyer la modification' : 'Envoyer ma demande') : contactFor === 'login' ? (backend.kind === 'http' ? 'Recevoir mon lien' : 'Voir mes pièces') : 'Enregistrer'}
          busy={sending}
          info={loginInfo}
          devLink={contactFor === 'login' ? devLink : undefined}
          onSubmit={contactFor === 'send' ? send : contactFor === 'login' ? login : saveProfile}
          onClose={() => { setContactFor(null); setLoginInfo(undefined); setDevLink(undefined); }}
          onForget={() => {
            saveClient(null);
            setClient(null);
          }}
        />
      )}
    </main>
  );
}
