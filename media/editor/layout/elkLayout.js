/* ********************************************************************************
 * Copyright: SELab.AI (c) 2026
 ********************************************************************************/
// ELK layout adapter for SysML Editor webview
// Exposes SELAB.applyElkLayout(diagramData, options?) and falls back gracefully.
(function() {
  const NS = (window.SELAB = window.SELAB || {});

  /**
   * Apply ELK (Eclipse Layout Kernel) layout to the given in-memory diagram data.
   * diagramData: { elements: [{id, name, width, height, x, y}], connections: [{id, source, target}] }
   * options: optional ELK layout options
   */
  NS.applyElkLayout = async function(diagramData, options = {}) {
    try {
      if (!diagramData || !Array.isArray(diagramData.elements)) return;
      const ELKCtor = window.ELK;
      if (typeof ELKCtor !== 'function') {
        console.log('[applyElkLayout] ELK not available, using fallback grid');
        fallbackGrid(diagramData);
        return;
      }

      // displaySettings에서 ELK 설정 참조
      const DS = window.SELAB?.Editor?.config?.displaySettings;
      const ELK_CFG = DS?.elk;
  

      const elk = new ELKCtor();
      const nodeById = new Map();
      const idByName = new Map();
      for (const n of diagramData.elements) {
        nodeById.set(n.id, n);
        idByName.set(n.name, n.id);
      }

      function isHierarchicalEdgeKind(kind) {
        if (!kind) return false;
        const k = String(kind).toLowerCase();
        // [SELab.AI] composition/shared는 독립 노드로 렌더링하므로 계층 관계가 아님
        if (k === 'composition' || k.includes('composition') || k === 'shared') {
          return false;
        }
        if (k.includes('inheritance') || k.includes('specialization') || k.includes('generalization')) {
            return false;
        }
        return (
          k.includes('contain') ||
          k.includes('own') ||
          k.includes('aggregate') ||
          k.includes('nest') ||
          k.includes('member') ||
          k.includes('usage') ||
          k.includes('perform') ||
          k.includes('include') ||
          k.includes('has') ||
          k.includes('annotation')  // metadata about 구문의 annotation edge 제외
        );
      }

      function isSpecializationEdgeKind(kind) {
        if (!kind) return false;
        const k = String(kind).toLowerCase();
        return k.includes('inheritance') || k.includes('specialization') || k.includes('generalization');
      }

      const finalLayoutOptions = Object.assign({
          'elk.algorithm': ELK_CFG?.algorithm ?? 'layered',
          'elk.direction': ELK_CFG?.direction ?? 'DOWN',
          'elk.spacing.nodeNode': String(ELK_CFG?.nodeNodeSpacing ?? 80),
          'elk.layered.spacing.nodeNodeBetweenLayers': String(ELK_CFG?.nodeNodeBetweenLayers ?? 80),
          'elk.spacing.componentComponent': String(ELK_CFG?.componentComponentSpacing ?? 80),
          'elk.layered.spacing.edgeNodeBetweenLayers': String(ELK_CFG?.edgeNodeBetweenLayers ?? 40),
          'elk.spacing.edgeNode': String(ELK_CFG?.edgeNodeSpacing ?? 40),
          'elk.layered.considerModelOrder.strategy': ELK_CFG?.modelOrderStrategy ?? 'NODES_AND_EDGES',
          'elk.layered.nodePlacement.strategy': ELK_CFG?.nodePlacement ?? 'NETWORK_SIMPLEX',
          'elk.edgeRouting': ELK_CFG?.edgeRouting ?? 'ORTHOGONAL',
          'elk.hierarchyHandling': ELK_CFG?.hierarchyHandling ?? 'INCLUDE_CHILDREN',
          'elk.spacing.edgeEdge': String(ELK_CFG?.edgeEdgeSpacing ?? 15),
          'elk.spacing.edgeEdgeBetweenLayers': String(ELK_CFG?.edgeEdgeBetweenLayers ?? 15),
          'elk.layered.mergeEdges': String(ELK_CFG?.mergeEdges ?? false),
          'elk.layered.mergeHierarchyEdges': String(ELK_CFG?.mergeHierarchyEdges ?? false),
          'elk.layered.crossingMinimization.strategy': ELK_CFG?.crossingMinimization ?? 'LAYER_SWEEP',
          'elk.layered.compaction.postCompaction.strategy': ELK_CFG?.compactionStrategy ?? 'EDGE_LENGTH',
          'elk.layered.compaction.connectedComponents': String(ELK_CFG?.compactConnectedComponents ?? true),
          'elk.layered.thoroughness': String(ELK_CFG?.thoroughness ?? 7),
          'elk.layered.cycleBreaking.strategy': 'MODEL_ORDER'
        }, options || {});

      // Fork 병렬 분기 감지: fork 후속 노드 간 flow 엣지는 ELK 레이어 제약에서 제외
      const forkSuccessors = new Map();
      {
        const allConns = Array.isArray(diagramData.connections) ? diagramData.connections : [];
        for (const e of allConns) {
          const kind = String(e.kind || e.type || '').toLowerCase();
          if (!kind.includes('succession') && !kind.includes('then') && !kind.includes('transition')) continue;
          const s = resolveIdDirect(e.source);
          if (!s) continue;
          const sNode = nodeById.get(s);
          const sKind = String(sNode?.kind || sNode?.type || '').toLowerCase();
          if (!sKind.includes('fork')) continue;
          const t = resolveIdDirect(e.target);
          if (!t) continue;
          if (!forkSuccessors.has(s)) forkSuccessors.set(s, new Set());
          forkSuccessors.get(s).add(t);
        }
      }

      function areForkSiblings(id1, id2) {
        for (const [, successors] of forkSuccessors) {
          if (successors.has(id1) && successors.has(id2)) return true;
        }
        return false;
      }

      // composition 엣지의 타겟 노드 수집 (featuretyping 필터링에서 사용)
      const compositionTargets = new Set();
      {
        const allConns = Array.isArray(diagramData.connections) ? diagramData.connections : [];
        for (const e of allConns) {
          const kind = String(e.kind || e.type || '').toLowerCase();
          if (kind === 'composition' || kind.includes('composition') || kind === 'shared') {
            const t = e.target;
            if (t && nodeById.has(t)) {
              compositionTargets.add(t);
            } else if (t && idByName.has(t)) {
              compositionTargets.add(idByName.get(t));
            }
          }
        }
      }

      // 엣지 수집
      const routeMetaByElkEdgeId = new Map();
      const topSpecializationTargets = new Set();
      {
        const specSources = new Set();
        const specTargets = new Set();
        const incomingNonSpecTargets = new Set();
        const allConns = Array.isArray(diagramData.connections) ? diagramData.connections : [];
        for (const e of allConns) {
          const kind = e.kind || e.type;
          const kindLower = String(kind || '').toLowerCase();
          const s = resolveIdDirect(e.source);
          const t = resolveIdDirect(e.target);
          if (!s || !t || s === t) continue;
          if (isSpecializationEdgeKind(kind)) {
            specSources.add(s);
            specTargets.add(t);
          } else if (!isHierarchicalEdgeKind(kindLower)) {
            incomingNonSpecTargets.add(t);
          }
        }
        for (const targetId of specTargets) {
          if (!specSources.has(targetId) && !incomingNonSpecTargets.has(targetId)) {
            topSpecializationTargets.add(targetId);
          }
        }
      }

      const allElkEdges = (() => {
        const all = Array.isArray(diagramData.connections) ? diagramData.connections : [];
        const kept = [];
        const seenPairs = new Set();

        // 1차: 기존 엣지 처리 (직접 해석만, 부모 폴백 없음)
        for (const e of all) {
          const kind = e.kind || e.type;
          if (isHierarchicalEdgeKind(kind) && !e.kindClass) {
            continue;
          }
          let s = resolveIdDirect(e.source);
          let t = resolveIdDirect(e.target);
          // border node(port) → 부모 노드 해석 (featuretyping 에지 라우팅 지원)
          const kindLower = String(kind || '').toLowerCase();
          if (kindLower === 'featuretyping') {
            if (!s) s = resolveId(e.source);
            if (!t) t = resolveId(e.target);
          }
          if (!s || !t || s === t) {
            continue;
          }
          // Block diagram featuretyping often crosses container boundaries
          // (usage at root -> definition nested in a block). Keep it in ELK so
          // mxGraph does not have to guess a route after layout.
          const routeReversed = isSpecializationEdgeKind(kindLower);
          const layoutSource = routeReversed ? t : s;
          const layoutTarget = routeReversed ? s : t;
          const pairKey = `${layoutSource}__${layoutTarget}`;
          const edgeId = e.id || pairKey;
          seenPairs.add(pairKey);
          if (routeReversed) {
            routeMetaByElkEdgeId.set(edgeId, { reverseWaypoints: true });
          }
          const elkEdge = { id: edgeId, sources: [layoutSource], targets: [layoutTarget] };
          if (routeReversed) {
            elkEdge.layoutOptions = {
              'elk.layered.priority.direction': 50,
              'elk.layered.priority.shortness': 10,
              'elk.layered.priority.straightness': 10,
            };
          }
          kept.push(elkEdge);
        }

        // 2차: flow 엣지의 border node → 부모 노드 해석 (같은 컨테이너 내부만)
        for (const e of all) {
          const kind = String(e.kind || e.type || '').toLowerCase();
          if (!kind.includes('flow')) continue;
          const s = resolveId(e.source);
          const t = resolveId(e.target);
          if (!s || !t || s === t) continue;
          // fork 병렬 분기 간 flow 엣지는 레이어 제약에서 제외
          if (areForkSiblings(s, t)) continue;
          const pairKey = `${s}__${t}`;
          if (seenPairs.has(pairKey)) continue;
          const sNode = nodeById.get(s);
          const tNode = nodeById.get(t);
          if (!sNode || !tNode) continue;
          if (!sNode.parent || !tNode.parent || sNode.parent !== tNode.parent) continue;
          seenPairs.add(pairKey);
          kept.push({ id: e.id || `flow_${pairKey}`, sources: [s], targets: [t] });
        }

        // 3차: body 타겟 → succession 타겟 가상 엣지 추가 (레이어 분리용)
        const bodyTgts = new Map();
        const succTgts = new Map();
        for (const e of all) {
          const kind = String(e.kind || e.type || '').toLowerCase();
          const s = resolveIdDirect(e.source);
          const t = resolveIdDirect(e.target);
          if (!s || !t || s === t) continue;
          if (kind === 'body') {
            if (!bodyTgts.has(s)) bodyTgts.set(s, []);
            bodyTgts.get(s).push(t);
          }
          if (kind.includes('succession') || kind.includes('then') || kind.includes('transition')) {
            if (!succTgts.has(s)) succTgts.set(s, []);
            succTgts.get(s).push(t);
          }
        }
        for (const [src, bts] of bodyTgts) {
          const sts = succTgts.get(src) || [];
          for (const bt of bts) {
            for (const st of sts) {
              if (bt === st) continue;
              const pairKey = `${bt}__${st}`;
              if (seenPairs.has(pairKey)) continue;
              seenPairs.add(pairKey);
              kept.push({ id: `_implicit_${pairKey}`, sources: [bt], targets: [st] });
            }
          }
        }

        return kept;
      })();

      // 부모 관계 맵 구축 (LCA 기반 엣지 배분용)
      const parentOf = new Map();
      for (const n of diagramData.elements) {
        if (n.parent) {
          const pid = nodeById.has(n.parent) ? n.parent : (idByName.get(n.parent) || null);
          if (pid && nodeById.has(pid)) parentOf.set(n.id, pid);
        }
      }

      // LCA 기반 엣지 배분: 같은 컨테이너 내 엣지는 해당 컨테이너 레벨에 배치
      function getAncestorChain(nid) {
        const chain = [];
        let cur = nid;
        while (cur) {
          chain.push(cur);
          cur = parentOf.get(cur) || null;
        }
        chain.push('root');
        return chain;
      }

      function findEdgeLCA(id1, id2) {
        const chain1 = getAncestorChain(id1);
        const set2 = new Set(getAncestorChain(id2));
        for (const a of chain1) {
          if (set2.has(a)) return a;
        }
        return 'root';
      }

      const edgesByContainer = new Map();
      edgesByContainer.set('root', []);
      for (const edge of allElkEdges) {
        const lca = findEdgeLCA(edge.sources[0], edge.targets[0]);
        if (!edgesByContainer.has(lca)) edgesByContainer.set(lca, []);
        edgesByContainer.get(lca).push(edge);
      }

      // 컨테이너 노드에 엣지 부착
      function attachEdgesToHierarchy(node) {
        const containerEdges = edgesByContainer.get(node.id);
        if (containerEdges && containerEdges.length > 0) {
          node.edges = containerEdges;
        }
        if (node.children) {
          for (const child of node.children) attachEdgesToHierarchy(child);
        }
      }

      const elkChildren = buildHierarchy(diagramData.elements);
      const elkGraph = {
        id: 'root',
        layoutOptions: finalLayoutOptions,
        children: elkChildren,
        edges: edgesByContainer.get('root') || [],
      };
      for (const child of elkGraph.children) attachEdgesToHierarchy(child);

      // 직접 해석만 (부모 폴백 없음) - 메인 엣지 루프용
      function resolveIdDirect(ref) {
        if (!ref) return null;
        if (nodeById.has(ref)) return ref;
        return idByName.get(ref) || null;
      }

      // 부모 폴백 포함 - flow 엣지 및 computeRanks용
      function resolveId(ref) {
        if (!ref) return null;
        if (nodeById.has(ref)) return ref;
        const byNameResult = idByName.get(ref);
        if (byNameResult) return byNameResult;
        // Border node/port → 부모 노드로 해석 (data flow 엣지 레이어링 지원)
        let current = String(ref);
        while (true) {
          const sepIdx = current.lastIndexOf('::');
          if (sepIdx <= 0) break;
          current = current.substring(0, sepIdx);
          if (nodeById.has(current)) return current;
          const parentByName = idByName.get(current);
          if (parentByName) return parentByName;
        }
        return null;
      }

      // Build compound hierarchy for ELK using explicit parent or qualified name ("::") inference.
      function buildHierarchy(nodes) {
        const byId = new Map(nodes.map(n => [n.id, n]));
        const byName = new Map(nodes.map(n => [n.name, n]));
        const parentIdOf = new Map(); // childId -> parentId

        function findQualifiedParentId(el) {
          if (!el || !el.name) return null;
          const parts = String(el.name).split('::');
          if (parts.length <= 1) return null;
          // try longest prefix first
          for (let i = parts.length - 1; i > 0; i--) {
            const prefix = parts.slice(0, i).join('::');
            const p = byName.get(prefix);
            if (p) return p.id;
          }
          return null;
        }

        // Assign parents: prefer explicit element.parent (id or name), else infer from qualified name
        for (const n of nodes) {
          const nodeType = String(n.type || '').toLowerCase();
          let pid = null;
          if (n.parent) {
            pid = byId.has(n.parent) ? n.parent : (byName.get(String(n.parent))?.id || null);
          }
          // composition target은 hierarchy.js에서 Package 레벨로 설정됨 → qualified name fallback 건너뜀
          if (!pid && !compositionTargets.has(n.id)) {
            pid = findQualifiedParentId(n);
          }
          // composition 타겟 노드는 hierarchy.js에서 이미 Package 레벨로 승격됨
          // buildHierarchy에서 추가 승격 불필요
          if (pid && pid !== n.id && byId.has(pid)) {
            parentIdOf.set(n.id, pid);
          }
        }

        // Build children lists
        const childrenOf = new Map(); // parentId -> childIds[]
        for (const n of nodes) {
          const pid = parentIdOf.get(n.id) || 'root';
          if (!childrenOf.has(pid)) childrenOf.set(pid, []);
          childrenOf.get(pid).push(n.id);
        }

        function roleWeight(n) {
          const r = String(n.role || '').toLowerCase();
          const t = String(n.type || '').toLowerCase();
          if (r === 'initial' || t === 'startaction') return -1;
          if (r === 'fork') return 0;
          // ElseIfAction/ElseAction은 then ActionUsage보다 뒤에 배치
          if (t === 'elseifaction') return 1.5;
          if (t === 'elseaction') return 1.8;
          if (t.includes('action') && !t.includes('definition')) return 1;
          if (r === 'join') return 2;
          if (r === 'final') return 3;
          return 2;
        }

        // Compute topological ranks within a container using in-container controlflow edges
        function computeRanks(parentId) {
          const childIds = new Set(childrenOf.get(parentId) || []);
          const indeg = new Map();
          const adj = new Map();
          // init
          for (const cid of childIds) { indeg.set(cid, 0); adj.set(cid, []); }
          // collect edges inside this container
          const allConns = Array.isArray(diagramData.connections) ? diagramData.connections : [];
          // body 엣지의 소스→타겟 매핑 (암시적 순서 생성용)
          const bodyTargetsBySource = new Map();
          const successionTargetsBySource = new Map();
          for (const e of allConns) {
            const kind = String(e.kind || e.type || '').toLowerCase();
            const s = resolveId(e.source);
            const t = resolveId(e.target);
            if (!s || !t || s === t || !childIds.has(s) || !childIds.has(t)) continue;
            if (kind === 'body') {
              if (!bodyTargetsBySource.has(s)) bodyTargetsBySource.set(s, []);
              bodyTargetsBySource.get(s).push(t);
            }
            if (kind.includes('succession') || kind.includes('then') || kind.includes('transition')) {
              if (!successionTargetsBySource.has(s)) successionTargetsBySource.set(s, []);
              successionTargetsBySource.get(s).push(t);
            }
            if (!(kind.includes('control') || kind.includes('flow') || kind.includes('succession') || kind.includes('then') || kind.includes('transition') || kind === 'body' || kind === 'composition' || kind === 'shared' || kind === 'featuretyping')) continue;
            // fork 병렬 분기 간 flow 엣지는 순서 제약에서 제외
            if (kind.includes('flow') && areForkSiblings(s, t)) continue;
            adj.get(s).push(t);
            indeg.set(t, (indeg.get(t) || 0) + 1);
          }
          // body 타겟 → succession 타겟 암시적 순서 추가
          // (loop body는 loop 종료 후 실행되는 노드보다 먼저 배치)
          for (const [src, bodyTargets] of bodyTargetsBySource) {
            const succTargets = successionTargetsBySource.get(src) || [];
            for (const bt of bodyTargets) {
              for (const st of succTargets) {
                if (bt !== st && childIds.has(bt) && childIds.has(st)) {
                  adj.get(bt).push(st);
                  indeg.set(st, (indeg.get(st) || 0) + 1);
                }
              }
            }
          }
          // Kahn's algorithm to assign ranks (longest distance from sources)
          const rank = new Map();
          const q = [];
          for (const cid of childIds) {
            if ((indeg.get(cid) || 0) === 0) { q.push(cid); rank.set(cid, 0); }
          }
          while (q.length > 0) {
            const u = q.shift();
            const ru = rank.get(u) || 0;
            for (const v of (adj.get(u) || [])) {
              const newRank = Math.max(ru + 1, rank.get(v) || 0);
              rank.set(v, newRank);
              indeg.set(v, (indeg.get(v) || 0) - 1);
              if ((indeg.get(v) || 0) === 0) q.push(v);
            }
          }

          // 사이클 처리: ranked 노드에서 BFS로 unranked 후속 노드에 rank 전파
          const propagateQ = [];
          for (const cid of childIds) {
            if (rank.has(cid)) propagateQ.push(cid);
          }
          while (propagateQ.length > 0) {
            const u = propagateQ.shift();
            const ru = rank.get(u) || 0;
            for (const v of (adj.get(u) || [])) {
              if (!rank.has(v)) {
                rank.set(v, ru + 1);
                propagateQ.push(v);
              }
            }
          }

          return rank;
        }

        function toElkChildren(parentId) {
          const childIds = (childrenOf.get(parentId) || []).slice();
          const ranks = computeRanks(parentId);
          childIds.sort((a, b) => {
            const na = byId.get(a) || {}; const nb = byId.get(b) || {};
            // import된 패키지는 뒤로 (현재 패키지가 위, import 패키지가 아래)
            const ia = na.isImported ? 1 : 0;
            const ib = nb.isImported ? 1 : 0;
            if (ia !== ib) return ia - ib;
            const ra = ranks.has(a) ? ranks.get(a) : 0;
            const rb = ranks.has(b) ? ranks.get(b) : 0;
            if (ra !== rb) return ra - rb;
            const wa = roleWeight(na); const wb = roleWeight(nb);
            if (wa !== wb) return wa - wb;
            const an = String(na.name || ''); const bn = String(nb.name || '');
            return an.localeCompare(bn);
          });

          // 부모가 IfAction인지 확인 (partitioning 적용 대상)
          const parentNode = byId.get(parentId);
          const parentTypeLower = String(parentNode?.type || '').toLowerCase();
          const parentIsIfAction = parentTypeLower.includes('ifaction');

          const elkChildren = childIds.map((cid) => {
            const n = byId.get(cid);

            function applyTopSpecializationConstraint(elkNode) {
              if (topSpecializationTargets.has(n.id)) {
                elkNode.layoutOptions = Object.assign({}, elkNode.layoutOptions || {}, {
                  'elk.layered.layering.layerConstraint': 'FIRST',
                });
              }
              return elkNode;
            }

            // collapsed 상태이면 자식 무시하고 leaf 노드로 처리
            const hasKids = childrenOf.has(n.id) && !n._collapsed;
            if (hasKids) {
              const typeLower = String(n.type || '').toLowerCase();
              const isIfAction = typeLower.includes('ifaction') || typeLower === 'elseifaction' || typeLower === 'elseaction';
              const isWhileLoop = typeLower.includes('whileloop');
              
              // IfActionUsage needs more top padding for condition label and branch labels (then/else)
              const CP = ELK_CFG?.containerPadding;
              const basePaddingTop = isIfAction ? (CP?.ifActionTop ?? 90) : (CP?.top ?? 10);
              // precomputeNodeSizes에서 계산한 compartment 높이를 basePaddingTop에 가산
              const paddingTop = basePaddingTop + (n._precomputedPaddingTop || 0);
              
              // WhileLoopActionUsage needs more bottom padding for 'until condition' label
              const paddingBottom = isWhileLoop ? (CP?.whileLoopBottom ?? 70) : (CP?.bottom ?? 10);

              // 컨테이너 내부: containerChildSpacing으로 actor 등 엣지 없는 자식 노드 간 세로 간격 제어
              // (별도 connected component로 처리되므로 componentComponentSpacing 사용)
              const childSpacing = String(ELK_CFG?.containerChildSpacing ?? 40);
              // actionFlow compartment가 있는 컨테이너는 spacing 축소
              const hasActionFlow = Array.isArray(n.compartments) &&
                n.compartments.some(c => c.key === 'actionFlow');
              const AF = ELK_CFG?.actionFlow;
              const betweenLayers = hasActionFlow
                ? String(AF?.nodeNodeBetweenLayers ?? 50)
                : String(ELK_CFG?.nodeNodeBetweenLayers ?? 80);
              const edgeNodeBL = hasActionFlow
                ? String(AF?.edgeNodeBetweenLayers ?? 20)
                : String(ELK_CFG?.edgeNodeBetweenLayers ?? 40);
              const edgeNodeSp = hasActionFlow
                ? String(AF?.edgeNodeSpacing ?? 20)
                : String(ELK_CFG?.edgeNodeSpacing ?? 40);

              const containerLayoutOpts = {
                  'elk.padding': `top=${paddingTop},left=${CP?.left ?? 10},right=${CP?.right ?? 10},bottom=${paddingBottom}`,
                  'elk.spacing.nodeNode': String(ELK_CFG?.nodeNodeSpacing ?? 80),
                  'elk.layered.spacing.nodeNodeBetweenLayers': betweenLayers,
                  'elk.spacing.componentComponent': childSpacing,
                  'elk.layered.spacing.edgeNodeBetweenLayers': edgeNodeBL,
                  'elk.spacing.edgeNode': edgeNodeSp,
                  'elk.algorithm': ELK_CFG?.algorithm ?? 'layered',
                  'elk.direction': ELK_CFG?.direction ?? 'DOWN',
                  'elk.edgeRouting': ELK_CFG?.edgeRouting ?? 'ORTHOGONAL',
                  'elk.hierarchyHandling': ELK_CFG?.hierarchyHandling ?? 'INCLUDE_CHILDREN',
                  'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED'
              };

              const elkNodeChildren = toElkChildren(n.id);
              const elkNode = {
                id: n.id,
                labels: n.name ? [{ text: String(n.name) }] : undefined,
                layoutOptions: containerLayoutOpts,
                children: elkNodeChildren,
              };

              // IfAction 컨테이너: 자식 간 보이지 않는 순서 엣지로 세로 순서 강제
              if (isIfAction && elkNodeChildren.length > 1) {
                const orderEdges = [];
                for (let oi = 0; oi < elkNodeChildren.length - 1; oi++) {
                  orderEdges.push({
                    id: `__order_${elkNodeChildren[oi].id}_${elkNodeChildren[oi + 1].id}`,
                    sources: [elkNodeChildren[oi].id],
                    targets: [elkNodeChildren[oi + 1].id],
                  });
                }
                elkNode.edges = (elkNode.edges || []).concat(orderEdges);
              }

              return applyTopSpecializationConstraint(elkNode);
            } else {
              // [FIX] Start/Finalize nodes are rendered as small circles.
              // Force small size to prevent large gaps in edges.
              // ActionUsage 계열 타입만 이름으로 Start/Finalize 판별
              // item def Start 등은 제외 (ActionUsage, AcceptActionUsage, StartAction 등만 해당)
              const nameLower = String(n.name || '').toLowerCase();
              const kindLower = String(n.kind || '').toLowerCase();
              const isActionType = kindLower.includes('action') || kindLower === 'startaction' || kindLower === 'doneaction';
              
              if (isActionType && (nameLower === 'start' || nameLower === 'finalize')) {
                const SA = DS?.specialNode?.startAction;
                return applyTopSpecializationConstraint({
                  id: n.id,
                  width: Number(n.width) || SA?.width || 28,
                  height: Number(n.height) || SA?.height || 28,
                  labels: n.name ? [{ text: String(n.name) }] : undefined,
                });
              }
              // DoneAction / FinalNode: 이중 원으로 렌더링되는 노드
              if (kindLower === 'doneaction' || kindLower === 'finalnode' ||
                  (isActionType && nameLower === 'done')) {
                const DA = DS?.specialNode?.doneAction;
                return applyTopSpecializationConstraint({
                  id: n.id,
                  width: DA?.width ?? 34,
                  height: DA?.height ?? 34,
                  labels: n.name ? [{ text: String(n.name) }] : undefined,
                });
              }

              // collapsed 노드는 최소 크기로 강제 (precomputeNodeSizes 덮어쓰기 방지)
              if (n._collapsed) {
                return applyTopSpecializationConstraint({
                  id: n.id,
                  width: 120,
                  height: 40,
                  labels: n.name ? [{ text: String(n.name) }] : undefined,
                });
              }

              // Compartment가 있는 노드는 precomputeNodeSizes에서 이미 계산됨
              // ELK는 그 값을 그대로 사용
              let w = Number(n.width || (DS?.nodePrecompute?.minWidth ?? 120));
              let h = Number(n.height || 60);
              
              // ELK의 자체 계산은 사용하지 않음 (precomputeNodeSizes가 더 정확함)
              if (false && n.compartments && Array.isArray(n.compartments)) {
                // 실제 mxGraph 렌더링에 맞춘 상수
                const LABEL_LINE_HEIGHT = 16;
                const LABEL_PADDING_VERTICAL = 20;
                const COMPARTMENT_HEADER_HEIGHT = 18;
                const COMPARTMENT_ITEM_HEIGHT = 16;
                const COMPARTMENT_MARGIN = 6;
                const PADDING_X = 16; // 좌우 패딩 (8px * 2)
                const DOC_INDENT = 8; // doc compartment 들여쓰기
                
                // Canvas를 사용한 실제 텍스트 너비 측정
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                ctx.font = '11px Arial'; // mxGraph 기본 폰트
                
                function measureTextWidth(text) {
                  return ctx.measureText(text).width;
                }
                
                // 텍스트 줄바꿈 계산 함수 (실제 텍스트 너비 기반)
                function calculateWrappedLines(text, maxTextWidth) {
                  if (!text) return 1;
                  const lines = String(text).split('\n');
                  let totalLines = 0;
                  
                  for (const line of lines) {
                    if (!line) {
                      totalLines += 1;
                      continue;
                    }
                    
                    // 실제 텍스트 너비 측정
                    const lineWidth = measureTextWidth(line);
                    
                    if (lineWidth <= maxTextWidth) {
                      totalLines += 1;
                    } else {
                      // 단어 단위로 줄바꿈 (공백과 콜론 기준)
                      const words = line.split(/[\s:]+/).filter(w => w);
                      let currentLine = '';
                      let wrappedLineCount = 1;
                      
                      for (let i = 0; i < words.length; i++) {
                        const word = words[i];
                        const testLine = currentLine ? currentLine + ' ' + word : word;
                        const testWidth = measureTextWidth(testLine);
                        
                        if (testWidth > maxTextWidth && currentLine) {
                          // 현재 줄이 너무 길면 다음 줄로
                          wrappedLineCount++;
                          currentLine = word;
                        } else {
                          currentLine = testLine;
                        }
                      }
                      
                      totalLines += wrappedLineCount;
                    }
                  }
                  
                  return totalLines;
                }
                
                // 1단계: 필요한 너비 결정
                let maxWidth = 200; // 기본 최소 너비
                
                for (const comp of n.compartments) {
                  const items = Array.isArray(comp.items) ? comp.items : [];
                  const isDoc = comp.key === 'doc';
                  
                  for (const item of items) {
                    let itemText = '';
                    if (typeof item === 'object') {
                      itemText = isDoc ? (item.body || '') : (item.name || item.id || '');
                    } else {
                      itemText = String(item);
                    }
                    
                    // 가장 긴 단어의 실제 너비 측정
                    const words = itemText.split(/\s+/);
                    let maxWordWidth = 0;
                    for (const word of words) {
                      const wordWidth = measureTextWidth(word);
                      maxWordWidth = Math.max(maxWordWidth, wordWidth);
                    }
                    
                    const minWidth = maxWordWidth + PADDING_X + (isDoc ? DOC_INDENT : 0);
                    maxWidth = Math.max(maxWidth, minWidth);
                  }
                }
                
                // 최대 너비 제한
                maxWidth = Math.min(maxWidth, 300);
                
                // 2단계: 확정된 너비로 높이 계산
                const labelText = String(n.name || '');
                
                // 라벨도 너비 기반 줄바꿈 계산
                const labelAvailableWidth = maxWidth - PADDING_X;
                const labelWrappedLines = calculateWrappedLines(labelText, labelAvailableWidth);
                let totalHeight = labelWrappedLines * LABEL_LINE_HEIGHT + LABEL_PADDING_VERTICAL;
                
                for (const comp of n.compartments) {
                  const items = Array.isArray(comp.items) ? comp.items : [];
                  if (items.length === 0) continue;
                  
                  totalHeight += COMPARTMENT_HEADER_HEIGHT;
                  
                  const isDoc = comp.key === 'doc';
                  const availableWidth = maxWidth - PADDING_X - (isDoc ? DOC_INDENT : 0);
                  
                  for (const item of items) {
                    let itemText = '';
                    if (typeof item === 'object') {
                      itemText = isDoc ? (item.body || '') : (item.name || item.id || '');
                    } else {
                      itemText = String(item);
                    }
                    
                    const wrappedLines = calculateWrappedLines(itemText, availableWidth);
                    const itemHeight = wrappedLines * COMPARTMENT_ITEM_HEIGHT;
                    totalHeight += itemHeight;
                  }
                  
                  totalHeight += COMPARTMENT_MARGIN;
                }
                
                totalHeight += COMPARTMENT_MARGIN;
                
                w = maxWidth;
                h = totalHeight;
              }

              const elkNode = {
                id: n.id,
                width: w,
                height: h,
                labels: n.name ? [{ text: String(n.name) }] : undefined,
              };

              return applyTopSpecializationConstraint(elkNode);
            }
          });

          return elkChildren;
        }

        return toElkChildren('root');
      }

      // ELK mutates the input graph; a plain JSON copy keeps our route metadata
      // and browser-side model references independent from ELK internals.
      const result = await elk.layout(JSON.parse(JSON.stringify(elkGraph)));
      
      // Apply computed positions (and sizes) recursively to our diagramData
      // ELK 원본 상대 좌표(relativeX, relativeY)와 절대 좌표(x, y) 모두 저장
      // - mxGraph: relativeX, relativeY 사용 (부모 기준 상대 좌표)
      // - SVG: x, y 사용 (절대 좌표)
      function applyPositions(elkNode, offsetX, offsetY) {
        if (!elkNode || !Array.isArray(elkNode.children)) return;
        for (const child of elkNode.children) {
          const n = nodeById.get(child.id);
          const relX = Number(child.x || 0);
          const relY = Number(child.y || 0);
          const absX = Number(offsetX + relX);
          const absY = Number(offsetY + relY);
          if (n) {
            n.relativeX = relX;
            n.relativeY = relY;
            n.x = absX;
            n.y = absY;
            if (typeof child.width === 'number') n.width = Math.max(20, child.width);
            if (typeof child.height === 'number') n.height = Math.max(20, child.height);
          }
          if (Array.isArray(child.children)) {
            applyPositions(child, absX, absY);
          }
        }
      }
      applyPositions(result, 0, 0);

      /**
       * ELK 엣지 라우팅 결과를 diagramData.connections에 적용
       * @param {Object} elkNode - ELK 레이아웃 결과 노드
       * @param {number} offsetX - X 오프셋
       * @param {number} offsetY - Y 오프셋
       */
      function applyEdgeRouting(elkNode, offsetX, offsetY) {
        if (!elkNode) return;

        // 현재 레벨의 엣지 처리
        if (Array.isArray(elkNode.edges)) {
          for (const elkEdge of elkNode.edges) {
            const connection = diagramData.connections.find(c => c.id === elkEdge.id);
            if (!connection) continue;

            // ELK edge sections에서 경로 정보 추출
            if (elkEdge.sections && elkEdge.sections.length > 0) {
              const section = elkEdge.sections[0];
              const waypoints = [];

              // 시작점
              if (section.startPoint) {
                waypoints.push({
                  x: offsetX + section.startPoint.x,
                  y: offsetY + section.startPoint.y
                });
              }

              // 중간점 (bendPoints)
              if (Array.isArray(section.bendPoints)) {
                section.bendPoints.forEach(bp => {
                  waypoints.push({
                    x: offsetX + bp.x,
                    y: offsetY + bp.y
                  });
                });
              }

              // 끝점
              if (section.endPoint) {
                waypoints.push({
                  x: offsetX + section.endPoint.x,
                  y: offsetY + section.endPoint.y
                });
              }

              if (waypoints.length >= 2) {
                const meta = routeMetaByElkEdgeId.get(elkEdge.id);
                connection.waypoints = meta?.reverseWaypoints ? waypoints.reverse() : waypoints;
              }
            }
          }
        }

        // 자식 노드의 엣지 재귀 처리
        if (Array.isArray(elkNode.children)) {
          for (const child of elkNode.children) {
            const absX = offsetX + (child.x || 0);
            const absY = offsetY + (child.y || 0);
            applyEdgeRouting(child, absX, absY);
          }
        }
      }

      // Apply edge routing from ELK
      applyEdgeRouting(result, 0, 0);

      function applyFallbackEdgeRouting() {
        const connections = Array.isArray(diagramData.connections) ? diagramData.connections : [];

        function boundsFor(ref) {
          const id = resolveIdDirect(ref) || resolveId(ref);
          const n = id ? nodeById.get(id) : null;
          if (!n) return null;
          const x = Number(n.x || 0);
          const y = Number(n.y || 0);
          const w = Number(n.width || 120);
          const h = Number(n.height || 60);
          return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
        }

        function boundaryPoint(from, to) {
          const dx = to.cx - from.cx;
          const dy = to.cy - from.cy;
          if (Math.abs(dx) >= Math.abs(dy)) {
            return { x: dx >= 0 ? from.x + from.w : from.x, y: from.cy };
          }
          return { x: from.cx, y: dy >= 0 ? from.y + from.h : from.y };
        }

        function simplify(points) {
          return points.filter((point, index) => {
            if (index === 0) return true;
            const prev = points[index - 1];
            return Math.abs(prev.x - point.x) > 0.5 || Math.abs(prev.y - point.y) > 0.5;
          });
        }

        for (const connection of connections) {
          if (Array.isArray(connection.waypoints) && connection.waypoints.length >= 2) continue;
          const kind = connection.kind || connection.type;
          if (isHierarchicalEdgeKind(kind) && !connection.kindClass) continue;
          if (String(kind || '').toLowerCase() === 'containment') continue;

          const sourceBounds = boundsFor(connection.source);
          const targetBounds = boundsFor(connection.target);
          if (!sourceBounds || !targetBounds) continue;

          const start = boundaryPoint(sourceBounds, targetBounds);
          const end = boundaryPoint(targetBounds, sourceBounds);
          let waypoints;
          if (Math.abs(start.x - end.x) < 0.5 || Math.abs(start.y - end.y) < 0.5) {
            waypoints = [start, end];
          } else if (Math.abs(sourceBounds.cx - targetBounds.cx) >= Math.abs(sourceBounds.cy - targetBounds.cy)) {
            const midX = Math.round((start.x + end.x) / 2);
            waypoints = [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end];
          } else {
            const midY = Math.round((start.y + end.y) / 2);
            waypoints = [start, { x: start.x, y: midY }, { x: end.x, y: midY }, end];
          }
          connection.waypoints = simplify(waypoints);
        }
      }

      applyFallbackEdgeRouting();

      // Post-process: align nodes in the same container & rank horizontally
      // RE-ENABLED: ELK spacing을 고려하도록 개선된 alignRanks 사용
      if (typeof NS.alignRanks === 'function') {
        try { 
          NS.alignRanks(diagramData, { 
            debug: false,
            preserveElkSpacing: true
          }); 
        } catch (e) { 
          console.log('[applyElkLayout] alignRanks failed', e); 
        }
      }
    } catch (err) {
      console.log('[applyElkLayout] error - falling back to grid', err);
      fallbackGrid(diagramData);
    }
  };

  function fallbackGrid(diagramData) {
    const DS = window.SELAB?.Editor?.config?.displaySettings;
    const FG = DS?.grid?.fallback;
    const paddingX = FG?.paddingX ?? 150;
    const paddingY = FG?.paddingY ?? 58;
    const elementWidth = FG?.elementWidth ?? 120;
    const elementHeight = FG?.elementHeight ?? 80;
    
    // 부모-자식 관계 파악
    const elements = diagramData.elements || [];
    const parentMap = new Map(); // childId -> parentId
    const childrenMap = new Map(); // parentId -> [childIds]
    
    for (const el of elements) {
      if (el.parent) {
        parentMap.set(el.id, el.parent);
        if (!childrenMap.has(el.parent)) {
          childrenMap.set(el.parent, []);
        }
        childrenMap.get(el.parent).push(el.id);
      }
    }
    
    // 루트 레벨 요소만 그리드 배치
    const rootElements = elements.filter(el => !el.parent);
    const cols = Math.max(1, Math.ceil(Math.sqrt(rootElements.length || 1)));
    
    rootElements.forEach((element, index) => {
      const row = Math.floor(index / cols);
      const col = index % cols;
      element.x = paddingX + col * (elementWidth + paddingX);
      element.y = paddingY + row * (elementHeight + paddingY);
      element.width = element.width || elementWidth;
      element.height = element.height || elementHeight;
    });
    
    // 자식 요소는 부모 내부에 배치
    for (const el of elements) {
      if (el.parent) {
        const parent = elements.find(p => p.id === el.parent || p.name === el.parent);
        if (parent) {
          const siblings = childrenMap.get(el.parent) || [];
          const siblingIndex = siblings.indexOf(el.id);
          const siblingCols = Math.max(1, Math.ceil(Math.sqrt(siblings.length)));
          const siblingRow = Math.floor(siblingIndex / siblingCols);
          const siblingCol = siblingIndex % siblingCols;
          
          const innerPadding = FG?.innerPadding ?? 60;
          el.x = parent.x + innerPadding + siblingCol * (elementWidth + paddingX);
          el.y = parent.y + innerPadding + siblingRow * (elementHeight + paddingY);
          el.width = el.width || elementWidth;
          el.height = el.height || elementHeight;
        }
      }
    }
  }

})();
