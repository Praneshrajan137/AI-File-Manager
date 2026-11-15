import type { WorkspaceGraphEdge, WorkspaceGraphNode } from '@shared/contracts';

export const GRAPH_CANVAS_WIDTH = 840;
export const GRAPH_CANVAS_HEIGHT = 480;

export interface PositionedNode {
  node: WorkspaceGraphNode;
  x: number;
  y: number;
  radius: number;
  color: string;
}

export function getGraphNodeColor(fileType: string): string {
  const ext = fileType.toLowerCase();
  if (['ts', 'tsx', 'js', 'jsx', 'py', 'go', 'rs', 'java'].includes(ext)) return '#4f46e5';
  if (['md', 'markdown', 'mdx', 'txt'].includes(ext)) return '#047857';
  if (['json', 'yaml', 'yml', 'toml', 'sql', 'csv'].includes(ext)) return '#b45309';
  if (['pdf', 'docx'].includes(ext)) return '#be185d';
  return '#475569';
}

export function clampGraphZoom(zoom: number): number {
  return Math.max(0.5, Math.min(2.5, Number(zoom.toFixed(2))));
}

/**
 * Computes collision-free coordinates for graph nodes using degree-ordered elliptical rings
 * followed by a bounded deterministic repulsion pass to prevent label overlap.
 */
export function computeGraphLayout(
  nodes: WorkspaceGraphNode[],
  edges: WorkspaceGraphEdge[] = []
): PositionedNode[] {
  if (nodes.length === 0) return [];

  const cx = GRAPH_CANVAS_WIDTH / 2;
  const cy = GRAPH_CANVAS_HEIGHT / 2;

  const sorted = [...nodes].sort(
    (a, b) => b.inDegree + b.outDegree - (a.inDegree + a.outDegree) || a.name.localeCompare(b.name)
  );

  const placed: PositionedNode[] = sorted.map((node, index) => {
    const degree = node.inDegree + node.outDegree;
    if (index === 0 && sorted.length > 2) {
      return {
        node,
        x: cx,
        y: cy,
        radius: Math.min(24, 13 + Math.min(degree, 8)),
        color: getGraphNodeColor(node.fileType),
      };
    }

    const innerCount = Math.min(sorted.length - 1, 8);
    const isInner = index <= innerCount;
    const ringIndex = isInner ? index - 1 : index - innerCount - 1;
    const ringTotal = Math.max(1, isInner ? innerCount : sorted.length - innerCount - 1);
    const ringRadius = isInner ? 132 : 210;
    const angle = (ringIndex / ringTotal) * Math.PI * 2 - Math.PI / 2;

    return {
      node,
      x: cx + Math.cos(angle) * ringRadius * (isInner ? 1.2 : 1.45),
      y: cy + Math.sin(angle) * ringRadius * 0.86,
      radius: Math.min(22, 11 + Math.min(degree, 8)),
      color: getGraphNodeColor(node.fileType),
    };
  });

  if (placed.length <= 1) {
    return placed.map((p) => ({ ...p, x: Math.round(p.x), y: Math.round(p.y) }));
  }

  const indexByPath = new Map<string, number>();
  placed.forEach((p, idx) => indexByPath.set(p.node.path, idx));

  // Deterministic pairwise separation + gentle edge attraction to untangle dense clusters
  const minX = 56;
  const maxX = GRAPH_CANVAS_WIDTH - 56;
  const minY = 44;
  const maxY = GRAPH_CANVAS_HEIGHT - 56;

  for (let iter = 0; iter < 32; iter++) {
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i];
        const b = placed[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distSq = dx * dx + dy * dy;
        const minDist = a.radius + b.radius + 36;
        if (distSq < minDist * minDist) {
          const dist = Math.max(1, Math.sqrt(distSq));
          const push = ((minDist - dist) / dist) * 0.35;
          const ox = dx === 0 && dy === 0 ? 1 : dx * push;
          const oy = dy * push;
          a.x -= ox;
          a.y -= oy;
          b.x += ox;
          b.y += oy;
        }
      }
    }

    for (const edge of edges) {
      const si = indexByPath.get(edge.source);
      const ti = indexByPath.get(edge.target);
      if (si === undefined || ti === undefined || si === ti) continue;
      const a = placed[si];
      const b = placed[ti];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      if (dist > 150) {
        const pull = (dist - 150) * 0.015;
        const px = (dx / dist) * pull;
        const py = (dy / dist) * pull;
        a.x += px;
        a.y += py;
        b.x -= px;
        b.y -= py;
      }
    }

    for (const item of placed) {
      item.x = Math.max(minX, Math.min(maxX, item.x));
      item.y = Math.max(minY, Math.min(maxY, item.y));
    }
  }

  return placed.map((item) => ({
    ...item,
    x: Math.round(item.x),
    y: Math.round(item.y),
  }));
}
