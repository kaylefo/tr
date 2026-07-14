import type { ComponentStatus, PackComponentId, VisionTierId } from '../../config/vision';
import { COMPONENT_LABELS, VISION_TIERS } from '../../config/vision';
import { getJaEnPack } from './packStore';
import { getDb } from './db';

export type VisionPackStatus =
  | 'not_downloaded'
  | 'downloading'
  | 'preparing'
  | 'ready'
  | 'failed';

export interface VisionComponentRecord {
  id: PackComponentId;
  label: string;
  status: ComponentStatus;
  progress: number;
  loadedBytes?: number;
  totalBytes?: number;
  errorMessage?: string;
}

export interface VisionPackRecord {
  packId: string;
  tierId: VisionTierId;
  label: string;
  status: VisionPackStatus;
  components: VisionComponentRecord[];
  lastValidatedAt?: number;
  errorMessage?: string;
  version: number;
}

const PACK_SCHEMA_VERSION = 2;

function tierComponents(tierId: VisionTierId): PackComponentId[] {
  return VISION_TIERS.find((t) => t.tierId === tierId)?.components ?? [];
}

function defaultComponents(tierId: VisionTierId): VisionComponentRecord[] {
  return tierComponents(tierId).map((id) => ({
    id,
    label: COMPONENT_LABELS[id],
    status: 'pending' as ComponentStatus,
    progress: 0,
  }));
}

export function createDefaultVisionPack(tierId: VisionTierId): VisionPackRecord {
  const tier = VISION_TIERS.find((t) => t.tierId === tierId)!;
  return {
    packId: tier.packId,
    tierId,
    label: tier.label,
    status: 'not_downloaded',
    components: defaultComponents(tierId),
    version: PACK_SCHEMA_VERSION,
  };
}

export function derivePackStatus(components: VisionComponentRecord[]): VisionPackStatus {
  if (components.length === 0) return 'not_downloaded';
  if (components.every((c) => c.status === 'ready')) return 'ready';
  if (components.some((c) => c.status === 'failed')) return 'failed';
  if (components.some((c) => c.status === 'downloading' || c.status === 'preparing')) {
    return 'downloading';
  }
  return 'not_downloaded';
}

/** Drop stale components and align stored packs with the current tier definitions. */
export function normalizeVisionPack(pack: VisionPackRecord): VisionPackRecord {
  const tier = VISION_TIERS.find((t) => t.tierId === pack.tierId);
  if (!tier) return pack;

  const existing = new Map(pack.components.map((c) => [c.id, c]));
  const components = tier.components.map((id) => {
    const prev = existing.get(id);
    if (prev) {
      return { ...prev, id, label: COMPONENT_LABELS[id] };
    }
    return {
      id,
      label: COMPONENT_LABELS[id],
      status: 'pending' as ComponentStatus,
      progress: 0,
    };
  });

  return {
    ...pack,
    label: tier.label,
    components,
    status: derivePackStatus(components),
    version: PACK_SCHEMA_VERSION,
  };
}

export function allComponentsReady(pack: VisionPackRecord): boolean {
  const normalized = normalizeVisionPack(pack);
  return normalized.components.every((c) => c.status === 'ready');
}

export function isVisionPackOperational(pack: VisionPackRecord): boolean {
  const normalized = normalizeVisionPack(pack);
  return normalized.status === 'ready' && allComponentsReady(normalized);
}

export function pendingVisionComponents(pack: VisionPackRecord): VisionComponentRecord[] {
  return normalizeVisionPack(pack).components.filter((c) => c.status !== 'ready');
}

export async function repairVisionPack(tierId: VisionTierId): Promise<VisionPackRecord> {
  let pack = normalizeVisionPack(await getVisionPackRaw(tierId));
  const textPack = await getJaEnPack();

  if (textPack.status === 'ready') {
    pack = updateVisionComponent(pack, 'translation-ja-en', {
      status: 'ready',
      progress: 100,
      errorMessage: undefined,
    });
  }

  pack = {
    ...pack,
    status: derivePackStatus(pack.components),
    errorMessage: pack.status === 'ready' ? undefined : pack.errorMessage,
    lastValidatedAt: pack.status === 'ready' ? Date.now() : pack.lastValidatedAt,
  };

  await saveVisionPack(pack);
  return pack;
}

async function getVisionPackRaw(tierId: VisionTierId): Promise<VisionPackRecord> {
  const tier = VISION_TIERS.find((t) => t.tierId === tierId)!;
  const db = await getDb();
  const stored = await db.get('visionPacks', tier.packId);
  if (stored) return stored;
  return createDefaultVisionPack(tierId);
}

export async function getVisionPack(tierId: VisionTierId): Promise<VisionPackRecord> {
  const raw = await getVisionPackRaw(tierId);
  const normalized = normalizeVisionPack(raw);

  const changed =
    raw.version !== normalized.version ||
    raw.status !== normalized.status ||
    raw.components.length !== normalized.components.length ||
    raw.components.some((c, i) => c.id !== normalized.components[i]?.id);

  if (changed) {
    await saveVisionPack(normalized);
  }

  return normalized;
}

export async function saveVisionPack(pack: VisionPackRecord): Promise<void> {
  const db = await getDb();
  const normalized = normalizeVisionPack({
    ...pack,
    status: derivePackStatus(normalizeVisionPack(pack).components),
    version: PACK_SCHEMA_VERSION,
  });
  await db.put('visionPacks', normalized, normalized.packId);
}

export async function listVisionPacks(): Promise<VisionPackRecord[]> {
  return Promise.all(VISION_TIERS.map((t) => getVisionPack(t.tierId)));
}

export async function getActiveVisionPack(): Promise<VisionPackRecord | null> {
  const packs = await listVisionPacks();
  const ready = packs.filter((p) => isVisionPackOperational(p));
  if (ready.length === 0) return null;
  const order: VisionTierId[] = ['live', 'standard', 'essential'];
  for (const tierId of order) {
    const match = ready.find((p) => p.tierId === tierId);
    if (match) return match;
  }
  return ready[0] ?? null;
}

export async function getActiveVisionPackForMode(
  mode: 'photo' | 'live',
): Promise<VisionPackRecord | null> {
  const packs = await listVisionPacks();
  const ready = packs.filter((p) => isVisionPackOperational(p));
  if (mode === 'live') {
    return ready.find((p) => p.tierId === 'live') ?? null;
  }
  return ready[0] ?? null;
}

export async function deleteVisionPack(tierId: VisionTierId): Promise<void> {
  const db = await getDb();
  const pack = createDefaultVisionPack(tierId);
  await db.put('visionPacks', pack, pack.packId);
}

export function updateVisionComponent(
  pack: VisionPackRecord,
  componentId: PackComponentId,
  patch: Partial<VisionComponentRecord>,
): VisionPackRecord {
  const updated = {
    ...pack,
    components: pack.components.map((c) =>
      c.id === componentId ? { ...c, ...patch } : c,
    ),
  };
  return {
    ...updated,
    status: derivePackStatus(normalizeVisionPack(updated).components),
  };
}
