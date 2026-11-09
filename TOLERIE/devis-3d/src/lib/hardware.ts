// Goujonnage, sertissage et taraudage : ce qu'on pose dans un perçage, et le trou de préparation à découper.
// Valeurs de référence (inserts type PEM, taraudage ISO pas gros) : à valider par l'atelier selon le fournisseur.
import type { Hardware, HardwareKind, PartSpec, Thread } from './types';

export const THREADS: Thread[] = ['M3', 'M4', 'M5', 'M6', 'M8'];

export const HARDWARE_LABEL: Record<HardwareKind, string> = {
  ecrou: 'Écrou à sertir',
  goujon: 'Goujon à sertir',
  taraudage: 'Taraudage',
};

/** Diamètre du trou de préparation (mm) et épaisseur de tôle minimale (mm). */
export const PRE_HOLE: Record<HardwareKind, Record<Thread, { hole: number; minThickness: number }>> = {
  // Écrous à sertir (série S / CLS)
  ecrou: {
    M3: { hole: 4.22, minThickness: 0.8 },
    M4: { hole: 5.41, minThickness: 0.8 },
    M5: { hole: 6.35, minThickness: 0.8 },
    M6: { hole: 8.75, minThickness: 1.4 },
    M8: { hole: 10.5, minThickness: 1.4 },
  },
  // Goujons à sertir (série FH)
  goujon: {
    M3: { hole: 3, minThickness: 0.8 },
    M4: { hole: 4, minThickness: 1 },
    M5: { hole: 5, minThickness: 1 },
    M6: { hole: 6, minThickness: 1.2 },
    M8: { hole: 8, minThickness: 1.6 },
  },
  // Avant-trou de taraudage ; il faut au moins ~1 pas de filet en prise.
  taraudage: {
    M3: { hole: 2.5, minThickness: 1.5 },
    M4: { hole: 3.3, minThickness: 2 },
    M5: { hole: 4.2, minThickness: 2 },
    M6: { hole: 5, minThickness: 2.5 },
    M8: { hole: 6.8, minThickness: 3 },
  },
};

export const preHole = (h: Hardware) => PRE_HOLE[h.kind][h.thread];
export const hardwareCode = (h: Hardware) => `${h.kind === 'ecrou' ? 'Écrou' : h.kind === 'goujon' ? 'Goujon' : 'Taraud.'} ${h.thread}`;
/** Code court pour les plans DXF (ASCII). */
export const hardwareDxf = (h: Hardware) => `${h.kind === 'ecrou' ? 'ECROU' : h.kind === 'goujon' ? 'GOUJON' : 'TARAUDAGE'} ${h.thread} - PRE-TROU D${preHole(h).hole}`;

/** Inserts et taraudages de la pièce, regroupés : « 4 × Écrou à sertir M4 ». */
export function hardwareList(spec: PartSpec) {
  const map = new Map<string, { kind: HardwareKind; thread: Thread; count: number; hole: number; minThickness: number }>();
  for (const h of spec.holes) {
    if (!h.hardware) continue;
    const key = `${h.hardware.kind}:${h.hardware.thread}`;
    const cur = map.get(key);
    if (cur) cur.count++;
    else map.set(key, { ...h.hardware, count: 1, ...preHole(h.hardware) });
  }
  return [...map.values()];
}

/** Inserts trop gros pour l'épaisseur choisie (à signaler au client et au technicien). */
export const hardwareTooThin = (spec: PartSpec) => hardwareList(spec).filter((x) => spec.thickness < x.minThickness);

/** Prix indicatif d'un insert posé (fourniture + pose) ou d'un taraudage, € HT. */
export const HARDWARE_UNIT_PRICE: Record<HardwareKind, number> = { ecrou: 0.45, goujon: 0.4, taraudage: 0.3 };
export const HARDWARE_SETUP = 15;
