import type { ComponentStatus, PackComponentId, VisionTierId } from '../../config/vision';
import { COMPONENT_LABELS, VISION_TIERS } from '../../config/vision';
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

function defaultComponents(tierId: VisionTierId): VisionComponentRecord[] {
  const tier = VISION_TIERS.find((t) => t.tierId === tierId);
  if (!tier) return [];
  return tier.components.map((id) => ({
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
    version: 1,
  };
}

export async function getVisionPack(tierId: VisionTierId): Promise<VisionPackRecord> {
  const tier = VISION_TIERS.find((t) => t.tierId === tierId)!;
  const db = await getDb();
  const stored = await db.get('visionPacks', tier.packId);
  if (stored) return stored;
  return createDefaultVisionPack(tierId);
}

export async function saveVisionPack(pack: VisionPackRecord): Promise<void> {
  const db = await getDb();
  await db.put('visionPacks', pack, pack.packId);
}

export async function listVisionPacks(): Promise<VisionPackRecord[]> {
  return Promise.all(VISION_TIERS.map((t) => getVisionPack(t.tierId)));
}

export async function getActiveVisionPack(): Promise<VisionPackRecord | null> {
  const packs = await listVisionPacks();
  const ready = packs.filter((p) => p.status === 'ready');
  if (ready.length === 0) return null;
  const order: VisionTierId[] = ['live', 'standard', 'essential'];
  for (const tierId of order) {
    const match = ready.find((p) => p.tierId === tierId);
    if (match) return match;
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
  return {
    ...pack,
    components: pack.components.map((c) =>
      c.id === componentId ? { ...c, ...patch } : c,
    ),
  };
}

export function allComponentsReady(pack: VisionPackRecord): boolean {
  return pack.components.every((c) => c.status === 'ready');
}
