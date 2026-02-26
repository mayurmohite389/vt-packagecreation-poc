/**
 * Order inputs by plate type and order id: start_plate first, then content by orderId, then end_plate.
 */

const CLIP_TYPES_ORDER = { start_plate: 0, content: 1, end_plate: 2 };

/**
 * @typedef {{ path: string, clipType?: string, orderId?: number, aspectJsonPath?: string }} InputClip
 */

/**
 * Sort a manifest of clips into final order: start_plate(s), content (by orderId), end_plate(s).
 * @param {InputClip[]} manifest - Array of { path, clipType?, orderId?, aspectJsonPath? }
 * @returns {string[]} Ordered paths
 */
export function sortByPlateOrder(manifest) {
  return sortManifestByPlateOrder(manifest).map((x) => x.path);
}

/**
 * Sort manifest and return full items (so aspectJsonPath stays aligned with path).
 * @param {InputClip[]} manifest
 * @returns {InputClip[]} Sorted array of { path, clipType, orderId, aspectJsonPath? }
 */
export function sortManifestByPlateOrder(manifest) {
  if (!manifest?.length) return [];
  const normalized = manifest.map((item) => ({
    path: typeof item === 'string' ? item : item.path,
    clipType: (typeof item === 'object' && item.clipType) ? String(item.clipType).toLowerCase() : 'content',
    orderId: typeof item === 'object' && item.orderId != null ? Number(item.orderId) : 0,
    aspectJsonPath: typeof item === 'object' && item.aspectJsonPath != null ? String(item.aspectJsonPath).trim() || null : null,
  }));
  normalized.sort((a, b) => {
    const orderA = CLIP_TYPES_ORDER[a.clipType] ?? 1;
    const orderB = CLIP_TYPES_ORDER[b.clipType] ?? 1;
    if (orderA !== orderB) return orderA - orderB;
    if (a.clipType === 'content' && b.clipType === 'content') return a.orderId - b.orderId;
    return 0;
  });
  return normalized;
}

/**
 * Build ordered path list from simple paths plus optional start/end plate.
 * Order: startPlate (if any), ...contentPaths, endPlate (if any).
 * @param {string[]} contentPaths - Main content clip paths (order preserved)
 * @param {{ startPlate?: string, endPlate?: string }} plates
 * @returns {string[]} Ordered paths
 */
export function buildOrderedPaths(contentPaths, plates = {}) {
  const out = [];
  if (plates.startPlate) out.push(plates.startPlate);
  out.push(...contentPaths);
  if (plates.endPlate) out.push(plates.endPlate);
  return out;
}
