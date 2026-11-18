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
const GRAPH_NODE_COLLATOR = new Intl.Collator();

export function computeGraphLayout(
  nodes: WorkspaceGraphNode[],
  edges: WorkspaceGraphEdge[] = []
): PositionedNode[] {
  const n = nodes.length;
  if (n === 0) return [];

  const cx = GRAPH_CANVAS_WIDTH / 2;
  const cy = GRAPH_CANVAS_HEIGHT / 2;

  const sorted = [...nodes].sort(
    (a, b) =>
      b.inDegree + b.outDegree - (a.inDegree + a.outDegree) ||
      GRAPH_NODE_COLLATOR.compare(a.name, b.name)
  );

  const px = new Float64Array(n);
  const py = new Float64Array(n);
  const radii = new Float64Array(n);
  const innerCount = Math.min(n - 1, 8);
  const outerTotal = Math.max(1, n - innerCount - 1);

  for (let index = 0; index < n; index += 1) {
    const node = sorted[index];
    const degree = node.inDegree + node.outDegree;
    if (index === 0 && n > 2) {
      px[0] = cx;
      py[0] = cy;
      radii[0] = Math.min(24, 13 + Math.min(degree, 8));
      continue;
    }

    const isInner = index <= innerCount;
    const ringIndex = isInner ? index - 1 : index - innerCount - 1;
    const ringTotal = Math.max(1, isInner ? innerCount : outerTotal);
    const ringRadius = isInner ? 132 : 210;
    const angle = (ringIndex / ringTotal) * Math.PI * 2 - Math.PI / 2;

    px[index] = cx + Math.cos(angle) * ringRadius * (isInner ? 1.2 : 1.45);
    py[index] = cy + Math.sin(angle) * ringRadius * 0.86;
    radii[index] = Math.min(22, 11 + Math.min(degree, 8));
  }

  if (n > 1) {
    const indexByPath = new Map<string, number>();
    for (let i = 0; i < n; i += 1) {
      indexByPath.set(sorted[i].path, i);
    }

    const edgeSrcArr: number[] = [];
    const edgeDstArr: number[] = [];
    for (let e = 0; e < edges.length; e += 1) {
      const si = indexByPath.get(edges[e].source);
      const ti = indexByPath.get(edges[e].target);
      if (si !== undefined && ti !== undefined && si !== ti) {
        edgeSrcArr.push(si);
        edgeDstArr.push(ti);
      }
    }
    const edgeSrc = Int32Array.from(edgeSrcArr);
    const edgeDst = Int32Array.from(edgeDstArr);
    const edgeCount = edgeSrc.length;

    // Deterministic pairwise separation + gentle edge attraction to untangle dense clusters
    const minX = 56;
    const maxX = GRAPH_CANVAS_WIDTH - 56;
    const minY = 44;
    const maxY = GRAPH_CANVAS_HEIGHT - 56;

    for (let iter = 0; iter < 32; iter += 1) {
      for (let i = 0; i < n; i += 1) {
        const ri = radii[i] + 36;
        let xi = px[i];
        let yi = py[i];
        for (let j = i + 1; j < n; j += 1) {
          const dx = px[j] - xi;
          const dy = py[j] - yi;
          const minDist = ri + radii[j];
          const distSq = dx * dx + dy * dy;
          if (distSq < minDist * minDist) {
            const dist = distSq <= 1 ? 1 : Math.sqrt(distSq);
            const push = ((minDist - dist) / dist) * 0.35;
            const ox = dx === 0 && dy === 0 ? 1 : dx * push;
            const oy = dy * push;
            xi -= ox;
            yi -= oy;
            px[j] += ox;
            py[j] += oy;
          }
        }
        px[i] = xi;
        py[i] = yi;
      }

      for (let e = 0; e < edgeCount; e += 1) {
        const si = edgeSrc[e];
        const ti = edgeDst[e];
        const dx = px[ti] - px[si];
        const dy = py[ti] - py[si];
        const distSq = dx * dx + dy * dy;
        if (distSq > 22500) {
          const dist = Math.sqrt(distSq);
          const pull = ((dist - 150) * 0.015) / dist;
          const fx = dx * pull;
          const fy = dy * pull;
          px[si] += fx;
          py[si] += fy;
          px[ti] -= fx;
          py[ti] -= fy;
        }
      }

      for (let i = 0; i < n; i += 1) {
        const x = px[i];
        const y = py[i];
        px[i] = x < minX ? minX : x > maxX ? maxX : x;
        py[i] = y < minY ? minY : y > maxY ? maxY : y;
      }
    }
  }

  const out: PositionedNode[] = new Array(n);
  for (let i = 0; i < n; i += 1) {
    const node = sorted[i];
    out[i] = {
      node,
      x: Math.round(px[i]),
      y: Math.round(py[i]),
      radius: radii[i],
      color: getGraphNodeColor(node.fileType),
    };
  }
  return out;
}
