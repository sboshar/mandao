import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router';
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d';
import * as repo from '../db/repo';
import { useNavigationStore } from '../stores/navigationStore';
import { MeaningCard } from '../components/MeaningCard';
import { getMeaningPinyin } from '../lib/meaningPinyin';
import { numericStringToDiacritic } from '../services/toneSandhi';

// ============================================================
// Graph data types
// ============================================================

interface GraphNode {
  id: string;
  label: string;
  pinyin: string;
  english: string;
  type: 'word' | 'character' | 'component' | 'sentence' | 'pinyin';
  /** For rendering size */
  weight: number;
  /** Color group */
  group: number;
  /** True if the user has reviewed this node's sentence at least once,
   *  or if it's a word/character that composes one they have. Pinyin
   *  cluster nodes are 'seen' if any member character is seen. */
  seen: boolean;
  x?: number;
  y?: number;
}

interface GraphLink {
  source: string;
  target: string;
  type: 'character-of' | 'in-sentence' | 'same-pinyin';
}

interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

// ============================================================
// Theme-aware colors — read CSS variables at render time
// ============================================================

function getThemeColors() {
  const s = getComputedStyle(document.documentElement);
  const get = (v: string) => s.getPropertyValue(v).trim();
  return {
    word: get('--accent') || '#8b7355',
    character: get('--state-review') || '#f43f5e',
    component: get('--warning') || '#f97316',
    sentence: get('--success') || '#10b981',
    pinyin: '#8b5cf6',
    bgBase: get('--bg-base') || '#f5f1eb',
    bgSurface: get('--bg-surface') || '#faf8f5',
    bgInset: get('--bg-inset') || '#ece7df',
    textPrimary: get('--text-primary') || '#2e2b26',
    textSecondary: get('--text-secondary') || '#6b6560',
    textTertiary: get('--text-tertiary') || '#a09a93',
    border: get('--border') || 'rgba(0,0,0,0.08)',
  };
}

function getNodeColor(type: GraphNode['type'], colors: ReturnType<typeof getThemeColors>): string {
  switch (type) {
    case 'word': return colors.word;
    case 'character': return colors.character;
    case 'component': return colors.component;
    case 'sentence': return colors.sentence;
    case 'pinyin': return colors.pinyin;
    default: return colors.character;
  }
}

// ============================================================
// Build graph data from DB
// ============================================================

// `seen` is snapshotted here at build time. A card reviewed in the
// same session (via the MeaningCard overlay or another tab) won't
// un-fog its subtree until the page remounts or buildGraphData() runs
// again. Acceptable for now — fog is a coarse orientation tool, not a
// live indicator — but revisit if review-from-graph becomes common.
async function buildGraphData(): Promise<GraphData> {
  const [meanings, links, sentenceTokens, sentences, cards] = await Promise.all([
    repo.getAllMeanings(),
    repo.getAllMeaningLinks(),
    repo.getAllSentenceTokens(),
    repo.getAllSentences(),
    repo.getAllSrsCards(),
  ]);

  // A sentence is "seen" once any of its SRS cards has actually been
  // reviewed (reps > 0). Fresh sentences the user just added but never
  // studied don't count — the whole point of fog is to surface what
  // the user has actively engaged with vs the raw deck.
  const seenSentenceIds = new Set<string>();
  for (const c of cards) {
    if (c.reps > 0) seenSentenceIds.add(c.sentenceId);
  }

  // Meanings referenced by seen sentences, then fan out via
  // meaning_links — a seen compound word's character children count as
  // seen too (you encountered them while studying the word).
  const seenMeaningIds = new Set<string>();
  for (const t of sentenceTokens) {
    if (seenSentenceIds.has(t.sentenceId)) seenMeaningIds.add(t.meaningId);
  }
  const childrenOf = new Map<string, string[]>();
  for (const l of links) {
    const cs = childrenOf.get(l.parentMeaningId);
    if (cs) cs.push(l.childMeaningId);
    else childrenOf.set(l.parentMeaningId, [l.childMeaningId]);
  }
  const frontier = [...seenMeaningIds];
  while (frontier.length > 0) {
    const mId = frontier.pop()!;
    for (const childId of childrenOf.get(mId) ?? []) {
      if (!seenMeaningIds.has(childId)) {
        seenMeaningIds.add(childId);
        frontier.push(childId);
      }
    }
  }

  const nodes: GraphNode[] = [];
  const graphLinks: GraphLink[] = [];

  // Count how many sentences each meaning appears in (for weight)
  const meaningToSentenceCount = new Map<string, number>();
  for (const t of sentenceTokens) {
    meaningToSentenceCount.set(
      t.meaningId,
      (meaningToSentenceCount.get(t.meaningId) || 0) + 1
    );
  }

  // Also count via parent links (character inside compound word)
  const childToParentIds = new Map<string, Set<string>>();
  for (const link of links) {
    const set = childToParentIds.get(link.childMeaningId) || new Set();
    set.add(link.parentMeaningId);
    childToParentIds.set(link.childMeaningId, set);
  }

  for (const [childId, parentIds] of childToParentIds) {
    let indirectCount = 0;
    for (const parentId of parentIds) {
      indirectCount += meaningToSentenceCount.get(parentId) || 0;
    }
    meaningToSentenceCount.set(
      childId,
      (meaningToSentenceCount.get(childId) || 0) + indirectCount
    );
  }

  // Add meaning nodes
  for (const m of meanings) {
    const count = meaningToSentenceCount.get(m.id) || 0;
    nodes.push({
      id: m.id,
      label: m.headword,
      pinyin: getMeaningPinyin(m),
      english: m.englishShort,
      type: m.type,
      weight: Math.max(1, count),
      group: m.type === 'word' ? 0 : m.type === 'character' ? 1 : 2,
      seen: seenMeaningIds.has(m.id),
    });
  }

  // Add sentence nodes
  for (const s of sentences) {
    nodes.push({
      id: `s-${s.id}`,
      label: s.chinese.length > 8 ? s.chinese.slice(0, 8) + '…' : s.chinese,
      pinyin: s.pinyinSandhi,
      english: s.english,
      type: 'sentence',
      weight: 2,
      group: 3,
      seen: seenSentenceIds.has(s.id),
    });
  }

  // Add pinyin cluster nodes
  const pinyinGroups = new Map<string, string[]>();
  for (const m of meanings) {
    if (!m.pinyinNumeric) continue;
    // Use single-syllable pinyin for characters
    if (m.type === 'character' && m.pinyinNumeric.split(/\s+/).length === 1) {
      const group = pinyinGroups.get(m.pinyinNumeric) || [];
      group.push(m.id);
      pinyinGroups.set(m.pinyinNumeric, group);
    }
  }

  // Only show pinyin nodes that connect 2+ characters.
  // Node ID keeps the numeric form so navigation lookups still work;
  // the label renders the diacritic form for readability (zài not zai4).
  for (const [pinyin, meaningIds] of pinyinGroups) {
    if (meaningIds.length < 2) continue;
    const nodeId = `p-${pinyin}`;
    const diacritic = numericStringToDiacritic(pinyin);
    nodes.push({
      id: nodeId,
      label: diacritic,
      pinyin: diacritic,
      english: `${meaningIds.length} characters`,
      type: 'pinyin',
      weight: meaningIds.length,
      group: 4,
      // Cluster node is seen if any member character is seen — so the
      // cluster joins the visible subgraph as soon as one of its
      // characters has been studied.
      seen: meaningIds.some((id) => seenMeaningIds.has(id)),
    });
    for (const mId of meaningIds) {
      graphLinks.push({ source: nodeId, target: mId, type: 'same-pinyin' });
    }
  }

  // Character-of links (word → character)
  for (const link of links) {
    graphLinks.push({
      source: link.parentMeaningId,
      target: link.childMeaningId,
      type: 'character-of',
    });
  }

  // Sentence → meaning links
  for (const t of sentenceTokens) {
    graphLinks.push({
      source: `s-${t.sentenceId}`,
      target: t.meaningId,
      type: 'in-sentence',
    });
  }

  return { nodes, links: graphLinks };
}

// ============================================================
// Component
// ============================================================

export function GraphPage() {
  const navigate = useNavigate();
  const { open } = useNavigationStore();
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] });
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [colors, setColors] = useState(getThemeColors);
  const [loading, setLoading] = useState(true);
  const [fogEnabled, setFogEnabled] = useState(() => {
    // Persist the toggle so it survives reloads. Default on — the whole
    // point is that a 5000-sentence deck shouldn't look uniform before
    // you've studied most of it.
    const stored = localStorage.getItem('mandao_graph_fog');
    return stored === null ? true : stored === 'true';
  });
  useEffect(() => {
    localStorage.setItem('mandao_graph_fog', String(fogEnabled));
    // Once the force simulation has cooled, the canvas stops painting
    // on its own. Toggling fog changes the paint callbacks' behavior
    // but won't show until we ask the graph to redraw.
    const fg = fgRef.current as unknown as { refresh?: () => void } | undefined;
    fg?.refresh?.();
  }, [fogEnabled]);
  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<ForceGraphMethods | undefined>(undefined);

  useEffect(() => {
    buildGraphData().then((data) => {
      setGraphData(data);
      setLoading(false);
    });
  }, []);

  /** Precomputed neighbor map for connection-highlight on hover.
   *  Recomputed on data change (rare), O(links) memory — fine. */
  const neighborsById = useRef(new Map<string, Set<string>>());
  useEffect(() => {
    const map = new Map<string, Set<string>>();
    for (const link of graphData.links) {
      const s = typeof link.source === 'string' ? link.source : (link.source as any).id;
      const t = typeof link.target === 'string' ? link.target : (link.target as any).id;
      if (!map.has(s)) map.set(s, new Set());
      if (!map.has(t)) map.set(t, new Set());
      map.get(s)!.add(t);
      map.get(t)!.add(s);
    }
    neighborsById.current = map;
  }, [graphData]);

  // Tune the d3-force simulation once data has loaded.
  //   - Weaker repulsion keeps disconnected islands from drifting to
  //     opposite corners with no counterforce to pull them back.
  //   - Link distance + strength control how tightly connected nodes
  //     cluster. The defaults are too loose for our small graphs.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg || graphData.nodes.length === 0) return;
    const charge = fg.d3Force('charge') as { strength: (s: number) => unknown } | undefined;
    charge?.strength(-40);
    const link = fg.d3Force('link') as { distance: (d: number) => unknown } | undefined;
    link?.distance(32);
    fg.d3ReheatSimulation();
  }, [graphData]);

  // Re-read colors when theme changes
  useEffect(() => {
    const observer = new MutationObserver(() => setColors(getThemeColors()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    function updateSize() {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    }
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  // zoomToFit is driven by onEngineStop (set on ForceGraph2D below), so
  // the camera lands once the simulation has actually settled rather
  // than on a wall-clock timer that might fire before nodes finish
  // moving. We arm a once-per-load flag so the user's manual pan/zoom
  // isn't yanked back every time the sim retriggers.
  const autoFittedRef = useRef(false);
  useEffect(() => {
    autoFittedRef.current = false;
  }, [graphData]);

  const handleNodeClick = useCallback(
    (node: any) => {
      const n = node as GraphNode;
      if (n.type === 'sentence') {
        const sentenceId = n.id.replace('s-', '');
        open({ type: 'sentence', id: sentenceId });
      } else if (n.type === 'pinyin') {
        const pinyinNumeric = n.id.replace('p-', '');
        open({ type: 'pinyin', id: pinyinNumeric });
      } else {
        open({ type: 'meaning', id: n.id });
      }
    },
    [open]
  );

  const paintNode = useCallback(
    (node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const n = node as GraphNode;
      const x = n.x || 0;
      const y = n.y || 0;
      const isHovered = hoveredNode?.id === n.id;
      const isNeighbor =
        hoveredNode !== null &&
        hoveredNode.id !== n.id &&
        neighborsById.current.get(hoveredNode.id)?.has(n.id);
      const dimmedByHover = hoveredNode !== null && !isHovered && !isNeighbor;
      const fogged = fogEnabled && !n.seen && !isHovered;
      const dimmed = dimmedByHover || fogged;
      const baseSize = n.type === 'sentence' ? 4 : n.type === 'pinyin' ? 5 : 6;
      const size = baseSize + Math.sqrt(n.weight) * 2;
      const fontSize = Math.max(10 / globalScale, 2);
      const nodeColor = getNodeColor(n.type, colors);

      // Matte flat fill — no gradient, no ambient glow. Glow only when
      // the user is inspecting this node (hover) or its direct neighbor.
      if (isHovered) {
        ctx.shadowColor = nodeColor;
        ctx.shadowBlur = 16;
      } else if (isNeighbor) {
        ctx.shadowColor = nodeColor;
        ctx.shadowBlur = 6;
      }

      // Fogged nodes go deeper into the background than hover-dimmed
      // ones — they should read as ambient, not paused for you to
      // return to like a hover-dimmed neighbor would.
      const fillAlpha = fogged ? 0.1 : dimmedByHover ? 0.18 : 1;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, 2 * Math.PI);
      ctx.fillStyle = nodeColor;
      ctx.globalAlpha = fillAlpha;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;

      // Crisp ring separates overlapping nodes.
      ctx.strokeStyle = colors.bgBase;
      ctx.lineWidth = 1.2 / globalScale;
      ctx.globalAlpha = dimmed ? 0.25 : 1;
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Fogged nodes stay as pure color blobs so only the studied
      // subgraph carries text. `fogged` is false when `isHovered`
      // (see its definition above), so hover still reveals the label.
      if (!fogged && (globalScale > 0.5 || isHovered)) {
        const label = n.label;
        const isSingleChar = label.length === 1;
        // A single character can live inside the node; multi-character
        // words don't fit, so render them below like sentences/pinyin.
        const labelInside =
          (n.type === 'character' || n.type === 'component' || n.type === 'word') && isSingleChar;

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        if (labelInside) {
          // Inside-glyph is unreadable soup at low zoom — stay as a
          // blob until we're close enough to actually read the char.
          if (globalScale > 1.0 || isHovered) {
            // Size the glyph to fit inside the circle. Chinese characters
            // render at roughly their point size wide/tall, so aiming for
            // ~1.35× the radius keeps the glyph comfortably inside the ring.
            // Still clamp to a readable floor so tiny nodes don't become
            // unreadable pixel blobs when zoomed out.
            const charSize = Math.min(size * 1.35, 16 / globalScale);
            ctx.font = `bold ${charSize}px "SF Pro", system-ui, sans-serif`;
            ctx.fillStyle = '#ffffff';
            ctx.globalAlpha = dimmed ? 0.4 : 1;
            ctx.fillText(label, x, y + 1);
            ctx.globalAlpha = 1;

            if (globalScale > 1.4 || isHovered) {
              ctx.font = `${fontSize * 0.85}px "SF Pro", system-ui, sans-serif`;
              ctx.fillStyle = colors.textTertiary;
              ctx.globalAlpha = dimmed ? 0.3 : 1;
              const eng = n.english.length > 15 ? n.english.slice(0, 14) + '…' : n.english;
              ctx.fillText(eng, x, y + size + fontSize);
              ctx.globalAlpha = 1;
            }
          }
        } else {
          // Below-node label (sentences, pinyin clusters, multi-char words).
          ctx.font = `${n.type === 'pinyin' ? 'italic ' : 'bold '}${fontSize}px "SF Pro", system-ui, sans-serif`;
          ctx.fillStyle =
            n.type === 'pinyin' || n.type === 'sentence'
              ? colors.textTertiary
              : colors.textPrimary;
          ctx.globalAlpha = dimmed ? 0.3 : 1;
          ctx.fillText(label, x, y + size + fontSize * 0.8);
          ctx.globalAlpha = 1;
        }
      }
    },
    [hoveredNode, colors, fogEnabled]
  );

  const paintLink = useCallback(
    (link: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const source = link.source as any;
      const target = link.target as any;
      if (source.x == null || target.x == null) return;

      const l = link as GraphLink;
      const touchesHovered =
        hoveredNode !== null && (source.id === hoveredNode.id || target.id === hoveredNode.id);
      const dimmedByHover = hoveredNode !== null && !touchesHovered;
      const fogged = fogEnabled && !source.seen && !target.seen && !touchesHovered;
      // When fog is on, links entirely inside the studied subgraph
      // pop as the active layer — more saturated + thicker than the
      // baseline, short of the hover-highlight tier.
      const inSeenSubgraph =
        fogEnabled && source.seen && target.seen && !touchesHovered;
      // Opacity packed as a two-char hex suffix on the stroke color.
      //   fogged:        22  (still traceable — shows the graph's
      //                       shape even in the unstudied portion)
      //   hover-dimmed:  0d
      //   seen subgraph: 80  (studied content, pops without hover)
      //   touches hover: cc  (highlighted)
      //   default:       33  (baseline, fog off)
      const opacity = fogged
        ? '22'
        : dimmedByHover
          ? '0d'
          : touchesHovered
            ? 'cc'
            : inSeenSubgraph
              ? '80'
              : '33';
      const widthMul = touchesHovered ? 1.5 : inSeenSubgraph ? 1.3 : 1;

      // Uniform base width across link types — differentiation is
      // carried by color alone. Non-fogged edges render thicker so the
      // visible graph has more presence; fogged edges stay thin to
      // read as ambient.
      const baseWidth = fogged ? 1.0 : 1.8;
      ctx.beginPath();
      ctx.moveTo(source.x, source.y);
      ctx.lineTo(target.x, target.y);
      ctx.lineWidth = (baseWidth * widthMul) / globalScale;

      if (l.type === 'character-of') {
        ctx.strokeStyle = colors.character + opacity;
      } else if (l.type === 'same-pinyin') {
        ctx.strokeStyle = colors.pinyin + opacity;
      } else {
        // in-sentence: use textSecondary (medium gray) instead of
        // textTertiary (light gray) so these edges aren't washed out.
        ctx.strokeStyle = colors.textSecondary + opacity;
      }

      ctx.stroke();
    },
    [colors, hoveredNode, fogEnabled]
  );

  return (
    <div
      className="fixed inset-0 overflow-hidden"
      style={{
        background: `radial-gradient(ellipse at 50% 45%, var(--bg-surface) 0%, var(--bg-base) 70%, var(--bg-inset) 100%)`,
      }}
    >
      {/* Floating Back button — top-left, sits over the canvas.
          top-12 clears App.tsx's global top bar (h-10 + some padding). */}
      <button
        onClick={() => navigate('/')}
        className="absolute top-12 left-3 z-40 px-3 py-1.5 rounded-full text-xs font-medium transition-colors backdrop-blur-sm"
        style={{
          background: 'color-mix(in srgb, var(--bg-surface) 85%, transparent)',
          color: 'var(--text-secondary)',
          border: '1px solid var(--border)',
        }}
      >
        ← Back
      </button>

      {/* Fog toggle — bottom-left corner.
          Dims unstudied nodes so a big deck doesn't look uniform. */}
      <button
        type="button"
        onClick={() => setFogEnabled((v) => !v)}
        className="absolute bottom-3 left-3 z-40 px-3 py-1.5 rounded-full text-xs font-medium transition-colors backdrop-blur-sm"
        style={{
          background: 'color-mix(in srgb, var(--bg-surface) 85%, transparent)',
          color: fogEnabled ? 'var(--accent)' : 'var(--text-tertiary)',
          border: `1px solid ${fogEnabled ? 'color-mix(in srgb, var(--accent) 40%, transparent)' : 'var(--border)'}`,
        }}
        title={
          fogEnabled
            ? 'Fog is on — unreviewed nodes are dim'
            : 'Fog is off — all nodes at full opacity'
        }
      >
        {fogEnabled ? '◐ Fog: on' : '○ Fog: off'}
      </button>

      {/* Floating legend — bottom-right pill */}
      <div
        className="absolute bottom-3 right-3 z-40 px-3 py-2 rounded-xl text-xs backdrop-blur-sm flex flex-col gap-1.5"
        style={{
          background: 'color-mix(in srgb, var(--bg-surface) 85%, transparent)',
          border: '1px solid var(--border)',
          color: 'var(--text-tertiary)',
        }}
      >
        {([
          { label: 'Words', color: colors.word },
          { label: 'Characters', color: colors.character },
          { label: 'Sentences', color: colors.sentence },
          { label: 'Pinyin', color: colors.pinyin },
        ]).map((item) => (
          <span key={item.label} className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: item.color, boxShadow: `0 0 6px ${item.color}` }} />
            {item.label}
          </span>
        ))}
      </div>

      {/* Hover tooltip — same top-12 offset to clear the global chrome. */}
      {hoveredNode && (
        <div
          className="absolute top-12 left-1/2 -translate-x-1/2 z-40 px-4 py-2.5 rounded-xl shadow-2xl pointer-events-none backdrop-blur-sm"
          style={{
            background: 'color-mix(in srgb, var(--bg-surface) 92%, transparent)',
            border: `1px solid var(--border)`,
            color: 'var(--text-primary)',
          }}
        >
          <div className="flex items-center gap-3">
            <span className="text-2xl">{hoveredNode.label}</span>
            <div>
              <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>{hoveredNode.pinyin}</div>
              <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{hoveredNode.english}</div>
            </div>
          </div>
        </div>
      )}

      {/* Graph canvas — fills the viewport */}
      <div ref={containerRef} className="absolute inset-0">
        {loading ? (
          <div className="flex items-center justify-center h-full" style={{ color: 'var(--text-tertiary)' }}>
            <div className="flex flex-col items-center gap-3">
              <div
                className="w-10 h-10 rounded-full animate-spin"
                style={{
                  border: '2px solid var(--border)',
                  borderTopColor: 'var(--accent)',
                }}
              />
              <div className="text-xs">Building graph…</div>
            </div>
          </div>
        ) : graphData.nodes.length === 0 ? (
          <div className="flex items-center justify-center h-full" style={{ color: 'var(--text-tertiary)' }}>
            No data yet. Add some sentences first.
          </div>
        ) : (
          <ForceGraph2D
            ref={fgRef as any}
            width={dimensions.width}
            height={dimensions.height}
            graphData={graphData}
            nodeCanvasObject={paintNode}
            linkCanvasObject={paintLink}
            onNodeClick={handleNodeClick}
            onNodeHover={(node) => setHoveredNode(node as GraphNode | null)}
            nodePointerAreaPaint={(node: any, color, ctx) => {
              const n = node as GraphNode;
              const size = 6 + Math.sqrt(n.weight) * 2;
              ctx.beginPath();
              ctx.arc(n.x || 0, n.y || 0, size + 2, 0, 2 * Math.PI);
              ctx.fillStyle = color;
              ctx.fill();
            }}
            backgroundColor="transparent"
            linkDirectionalParticles={0}
            d3AlphaDecay={0.02}
            d3VelocityDecay={0.3}
            warmupTicks={50}
            cooldownTicks={200}
            onEngineStop={() => {
              if (autoFittedRef.current) return;
              autoFittedRef.current = true;
              fgRef.current?.zoomToFit(500, 80);
            }}
          />
        )}
      </div>

      {/* MeaningCard overlay */}
      <MeaningCard />
    </div>
  );
}
