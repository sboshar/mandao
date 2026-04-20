import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router';
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d';
import * as repo from '../db/repo';
import { useNavigationStore } from '../stores/navigationStore';
import { MeaningCard } from '../components/MeaningCard';
import { getMeaningPinyin } from '../lib/meaningPinyin';

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

async function buildGraphData(): Promise<GraphData> {
  const [meanings, links, sentenceTokens, sentences] = await Promise.all([
    repo.getAllMeanings(),
    repo.getAllMeaningLinks(),
    repo.getAllSentenceTokens(),
    repo.getAllSentences(),
  ]);

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

  // Only show pinyin nodes that connect 2+ characters
  for (const [pinyin, meaningIds] of pinyinGroups) {
    if (meaningIds.length < 2) continue;
    const nodeId = `p-${pinyin}`;
    nodes.push({
      id: nodeId,
      label: pinyin,
      pinyin: pinyin,
      english: `${meaningIds.length} characters`,
      type: 'pinyin',
      weight: meaningIds.length,
      group: 4,
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
  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<ForceGraphMethods | undefined>(undefined);

  useEffect(() => {
    buildGraphData().then(setGraphData);
  }, []);

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

  // Zoom to fit on load
  useEffect(() => {
    if (graphData.nodes.length > 0 && fgRef.current) {
      setTimeout(() => {
        fgRef.current?.zoomToFit(400, 60);
      }, 500);
    }
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
      const baseSize = n.type === 'sentence' ? 4 : n.type === 'pinyin' ? 5 : 6;
      const size = baseSize + Math.sqrt(n.weight) * 2;
      const fontSize = Math.max(10 / globalScale, 2);
      const nodeColor = getNodeColor(n.type, colors);

      // Glow effect on hover
      if (isHovered) {
        ctx.shadowColor = nodeColor;
        ctx.shadowBlur = 20;
      }

      // Node circle
      ctx.beginPath();
      ctx.arc(x, y, size, 0, 2 * Math.PI);
      ctx.fillStyle = nodeColor;
      ctx.globalAlpha = isHovered ? 1 : 0.85;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;

      // Ring
      if (n.type !== 'sentence') {
        ctx.strokeStyle = colors.bgSurface;
        ctx.lineWidth = 1.5 / globalScale;
        ctx.stroke();
      }

      // Label
      if (globalScale > 0.5 || isHovered) {
        const label = n.label;
        ctx.font = `${n.type === 'pinyin' ? 'italic ' : ''}${fontSize}px "SF Pro", system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        if (n.type === 'sentence' || n.type === 'pinyin') {
          // Label below node
          ctx.fillStyle = colors.textTertiary;
          ctx.fillText(label, x, y + size + fontSize * 0.8);
        } else {
          // Character/word label inside/on node
          const charSize = Math.max(14 / globalScale, 3);
          ctx.font = `bold ${charSize}px "SF Pro", system-ui, sans-serif`;
          ctx.fillStyle = '#ffffff';
          ctx.fillText(label, x, y + 1);

          // English below
          if (globalScale > 1.2 || isHovered) {
            ctx.font = `${fontSize * 0.85}px "SF Pro", system-ui, sans-serif`;
            ctx.fillStyle = colors.textTertiary;
            const eng =
              n.english.length > 15
                ? n.english.slice(0, 14) + '…'
                : n.english;
            ctx.fillText(eng, x, y + size + fontSize);
          }
        }
      }
    },
    [hoveredNode, colors]
  );

  const paintLink = useCallback(
    (link: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const source = link.source as any;
      const target = link.target as any;
      if (!source.x || !target.x) return;

      ctx.beginPath();
      ctx.moveTo(source.x, source.y);
      ctx.lineTo(target.x, target.y);

      const l = link as GraphLink;
      if (l.type === 'character-of') {
        ctx.strokeStyle = colors.character + '33';
        ctx.lineWidth = 1.5 / globalScale;
      } else if (l.type === 'same-pinyin') {
        ctx.strokeStyle = colors.pinyin + '26';
        ctx.lineWidth = 1 / globalScale;
        ctx.setLineDash([4 / globalScale, 4 / globalScale]);
      } else {
        ctx.strokeStyle = colors.textTertiary + '26';
        ctx.lineWidth = 0.8 / globalScale;
      }

      ctx.stroke();
      ctx.setLineDash([]);
    },
    [colors]
  );

  return (
    <div className="h-screen flex flex-col" style={{ background: 'var(--bg-base)' }}>
      {/* Header */}
      <div
        className="px-3 sm:px-4 pt-9 pb-0.5 backdrop-blur"
        style={{ background: 'var(--bg-surface)', borderBottom: `1px solid var(--border)` }}
      >
        <div className="flex items-center justify-between mb-0.5">
          <button
            onClick={() => navigate('/')}
            className="px-3 py-1 rounded-lg text-sm transition-colors"
            style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)' }}
          >
            &larr; Back
          </button>
          <h1 className="text-lg font-medium" style={{ color: 'var(--text-primary)' }}>
            Graph
          </h1>
          <div className="w-16" />
        </div>
        <div className="flex items-center justify-center gap-3 sm:gap-4 text-xs" style={{ color: 'var(--text-tertiary)' }}>
          {([
            { label: 'Words', color: colors.word },
            { label: 'Characters', color: colors.character },
            { label: 'Sentences', color: colors.sentence },
            { label: 'Pinyin', color: colors.pinyin },
          ]).map((item) => (
            <span key={item.label} className="flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: item.color }} />
              {item.label}
            </span>
          ))}
        </div>
      </div>

      {/* Hover tooltip */}
      {hoveredNode && (
        <div
          className="absolute top-16 left-1/2 -translate-x-1/2 z-40 px-4 py-2.5 rounded-xl shadow-2xl pointer-events-none backdrop-blur-sm"
          style={{ background: 'var(--bg-surface)', border: `1px solid var(--border)`, color: 'var(--text-primary)' }}
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

      {/* Graph */}
      <div ref={containerRef} className="flex-1 relative">
        {graphData.nodes.length === 0 ? (
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
          />
        )}
      </div>

      {/* MeaningCard overlay */}
      <MeaningCard />
    </div>
  );
}
