/* ********************************************************************************
 * Copyright: SELab.AI (c) 2026
 * MxCellFactory.js - mxGraph 셀 생성 팩토리 (조율자)
 * 정규화된 모델 데이터를 mxGraph 셀로 변환
 *
 * 분리된 모듈:
 * - MxLabelUtils.js: 라벨 포맷팅 및 스타일 유틸리티
 * - MxCompartmentRenderer.js: Compartment 렌더링
 * - MxLoopBodyRenderer.js: Loop body 렌더링
 * - MxVertexBuilder.js: 버텍스(노드) 생성
 * - MxEdgeBuilder.js: 엣지 및 Border Node 생성
 * ********************************************************************************/
(function () {
    'use strict';

    const ns = (window.SELAB = window.SELAB || {});
    ns.MxGraph = ns.MxGraph || {};
    ns.MxGraph.factory = ns.MxGraph.factory || {};
    const EMPTY_STATE_ID = 'mxGraphEmptyState';

    function log(prefix, ...args) {
        try {
            console.log(`[MxCellFactory] ${prefix}`, ...args);
        } catch (_) {}
    }

    function getEmptyStateOverlay(graph) {
        const container = graph?.container;
        if (!container) return null;
        return container.querySelector(`#${EMPTY_STATE_ID}`);
    }

    function ensureEmptyStateOverlay(graph) {
        const container = graph?.container;
        if (!container) return null;
        let overlay = getEmptyStateOverlay(graph);
        if (overlay) return overlay;
        overlay = document.createElement('div');
        overlay.id = EMPTY_STATE_ID;
        overlay.className = 'mxgraph-empty-state is-hidden';
        container.appendChild(overlay);
        return overlay;
    }

    function hideEmptyStateOverlay(graph) {
        const overlay = getEmptyStateOverlay(graph);
        if (!overlay) return;
        overlay.textContent = '';
        overlay.classList.add('is-hidden');
    }

    function getTranslatedEmptyMessage() {
        const tr = ns.Editor?.ui?.PropertyPanel?._translations
            || ns.Editor?._pendingPropertyPanelTranslations;
        if (tr?.emptyDiagram) return tr.emptyDiagram;
        return ns.Editor.renderUtils.getEmptyDiagramMessageText();
    }

    function showEmptyStateOverlay(graph) {
        const overlay = ensureEmptyStateOverlay(graph);
        if (!overlay) return;
        overlay.textContent = getTranslatedEmptyMessage();
        overlay.classList.remove('is-hidden');
    }

    /**
     * 부모 셀 크기를 자식 셀이 모두 포함되도록 확장 + 겹침 해소
     * 깊은 중첩부터 처리 (bottom-up)
     */
    function resizeParentsToFitChildren(graph, defaultParent, cellMap, nodes) {
        const PADDING = 20;
        const CHILD_GAP = 10;
        const graphModel = graph.getModel();

        // 부모→자식 맵핑
        const childrenOf = new Map();
        for (const node of nodes) {
            if (!node.parent || !cellMap[node.id] || !cellMap[node.parent]) continue;
            if (!childrenOf.has(node.parent)) childrenOf.set(node.parent, []);
            childrenOf.get(node.parent).push(node.id);
        }

        // 깊이 계산 (리프부터 처리)
        function getDepth(nodeId) {
            const children = childrenOf.get(nodeId);
            if (!children || children.length === 0) return 0;
            return 1 + Math.max(...children.map(getDepth));
        }

        // 깊이 오름차순 정렬 (리프의 부모부터 → 루트 방향)
        const parentIds = [...childrenOf.keys()].sort((a, b) => getDepth(a) - getDepth(b));

        for (const parentId of parentIds) {
            const parentCell = cellMap[parentId];
            if (!parentCell) continue;
            const children = childrenOf.get(parentId) || [];
            if (children.length === 0) continue;

            // 자식 셀 geometry 수집
            const childGeos = [];
            for (const childId of children) {
                const childCell = cellMap[childId];
                if (!childCell) continue;
                const geo = graphModel.getGeometry(childCell);
                if (!geo) continue;
                childGeos.push({ cell: childCell, geo });
            }

            if (childGeos.length === 0) continue;

            // 자식들을 부모 중앙에 배치
            const HEADER_H = 35; // swimlane 헤더 높이
            let minX = Infinity, minY = Infinity, maxR = 0, maxB = 0;
            for (const { geo } of childGeos) {
                minX = Math.min(minX, geo.x);
                minY = Math.min(minY, geo.y);
                maxR = Math.max(maxR, geo.x + geo.width);
                maxB = Math.max(maxB, geo.y + geo.height);
            }
            const childrenWidth = maxR - minX;
            const childrenHeight = maxB - minY;
            const parentGeoForCenter = graphModel.getGeometry(parentCell);
            if (parentGeoForCenter) {
                const availW = parentGeoForCenter.width;
                const availH = parentGeoForCenter.height - HEADER_H;
                // 중앙 오프셋 계산
                const centerX = Math.max(10, (availW - childrenWidth) / 2);
                const centerY = Math.max(HEADER_H + 5, HEADER_H + (availH - childrenHeight) / 2);
                const shiftX = minX - centerX;
                const shiftY = minY - centerY;
                if (Math.abs(shiftX) > 2 || Math.abs(shiftY) > 2) {
                    for (let ci = 0; ci < childGeos.length; ci++) {
                        const { cell, geo } = childGeos[ci];
                        const newGeo = geo.clone();
                        newGeo.x = geo.x - shiftX;
                        newGeo.y = geo.y - shiftY;
                        graphModel.setGeometry(cell, newGeo);
                        childGeos[ci].geo = newGeo;
                    }
                }
            }

            // 겹침 감지 및 해소
            for (let i = 0; i < childGeos.length; i++) {
                const a = childGeos[i].geo;
                for (let j = i + 1; j < childGeos.length; j++) {
                    const b = childGeos[j].geo;
                    if (a.x < b.x + b.width + CHILD_GAP && a.x + a.width + CHILD_GAP > b.x &&
                        a.y < b.y + b.height + CHILD_GAP && a.y + a.height + CHILD_GAP > b.y) {
                        const newGeo = b.clone();
                        newGeo.x = a.x + a.width + CHILD_GAP;
                        graphModel.setGeometry(childGeos[j].cell, newGeo);
                        childGeos[j].geo = newGeo;
                    }
                }
            }

            // 부모 크기를 자식에 맞게 조정 (확장 또는 축소)
            let maxRight2 = 0;
            let maxBottom2 = 0;
            for (const { geo } of childGeos) {
                maxRight2 = Math.max(maxRight2, geo.x + geo.width);
                maxBottom2 = Math.max(maxBottom2, geo.y + geo.height);
            }

            if (maxRight2 > 0 || maxBottom2 > 0) {
                const pGeo = graphModel.getGeometry(parentCell);
                if (pGeo) {
                    const fitW = maxRight2 + PADDING;
                    const fitH = maxBottom2 + PADDING;
                    // 부모 크기를 자식 fit 크기로 조정 (확장뿐 아니라 축소도)
                    const newGeo = pGeo.clone();
                    newGeo.width = Math.max(fitW, 100); // 최소 100
                    newGeo.height = Math.max(fitH, 60);
                    graphModel.setGeometry(parentCell, newGeo);
                }
            }
        }
    }

    function hasElkGeometry(nodes) {
        return Array.isArray(nodes) && nodes.some((node) =>
            node && (typeof node.relativeX === 'number' || typeof node.relativeY === 'number')
        );
    }

    /**
     * 정규화된 모델을 mxGraph로 렌더링
     * @param {mxGraph} graph - mxGraph 인스턴스
     * @param {Object} model - 정규화된 모델 { elements, connections } 또는 { nodes, edges }
     */
    function renderModel(graph, model) {
        if (!graph || !model) {
            log('렌더링 실패 - 그래프 또는 모델 없음');
            return;
        }

        const nodes = model.elements || model.nodes || [];
        const edges = model.connections || model.edges || [];
        const hasVisibleNodes = nodes.some((node) => node && !node.hidden);

        const cache = model.cache || ns.Editor._app?._modelCache;
        if (cache) {
            log(' 모델 캐시 사용 가능:', cache.getStats());
        } else {
            log(' 모델 캐시 없음 - 성능 저하 가능');
        }

        ns.MxGraph._currentApp = { model: { elements: nodes, edges: edges }, _modelCache: cache };
        // renderModel 중 CELLS_MOVED 이벤트 무시 플래그
        if (typeof ns.MxGraph._setRendering === 'function') ns.MxGraph._setRendering(true);
        log('모델 렌더링 시작. 노드:', nodes.length, '엣지:', edges.length);
        log('노드 ID 목록:', nodes.map(n => n.id));

        const graphModel = graph.getModel();
        const parent = graph.getDefaultParent();
        const cellMap = {};

        const _createVertex = ns.MxGraph.factory.createVertex;
        const _createEdge = ns.MxGraph.factory.createEdge;
        const _createBorderNode = ns.MxGraph.factory.createBorderNode;
        const _distributeOverlappingEdges = ns.MxGraph.factory.distributeOverlappingEdges;

        graphModel.beginUpdate();
        try {
            graph.removeCells(graph.getChildCells(parent, true, true));

            if (!hasVisibleNodes) {
                log('빈 모델 감지 - mxGraph empty-state 표시');
            } else {
                const borderNodeIds = new Set();
                const nodesById = cache ? null : new Map();
                const nodesByName = cache ? null : new Map();
                const parentGraphChildrenCount = new Map();

                nodes.forEach((node) => {
                    if (!cache) {
                        if (node?.id) nodesById.set(String(node.id), node);
                        if (node?.name) nodesByName.set(String(node.name), node);
                    }
                    if (node.parent) {
                        const pid = String(node.parent);
                        parentGraphChildrenCount.set(pid, (parentGraphChildrenCount.get(pid) || 0) + 1);
                    }
                });

                function resolveParentNode(node) {
                    if (!node || !node.parent) return null;
                    if (cache) return cache.getElement(node.parent);
                    const parentId = String(node.parent);
                    return nodesById.get(parentId) || nodesByName.get(parentId) || null;
                }

                function ensureCell(node) {
                    if (!node || cellMap[node.id]) return cellMap[node?.id];
                    // hidden 노드는 셀 생성 건너뜀 (collapse 상태)
                    if (node.hidden) return null;

                    let parentNode = resolveParentNode(node);
                    let parentCell = parent;
                    if (parentNode) {
                        parentCell = ensureCell(parentNode) || parent;
                    }

                    const hasGraphChildren = (parentGraphChildrenCount.get(String(node.id)) || 0) > 0;
                    const cell = _createVertex(graph, parentCell, node, parentNode, cellMap, hasGraphChildren);
                    if (cell) {
                        cellMap[node.id] = cell;

                        if (node.borderNodes && node.borderNodes.length > 0) {
                            const sideCountMap = {};
                            const sideTotalMap = {};
                            node.borderNodes.forEach((bn) => {
                                const s = String(bn.side || 'E').toUpperCase();
                                sideTotalMap[s] = (sideTotalMap[s] || 0) + 1;
                            });
                            node.borderNodes.forEach((borderNode, idx) => {
                                borderNodeIds.add(borderNode.id);
                                const s = String(borderNode.side || 'E').toUpperCase();
                                const sideIdx = sideCountMap[s] || 0;
                                sideCountMap[s] = sideIdx + 1;
                                const borderCell = _createBorderNode(graph, cell, borderNode, idx, node.borderNodes.length, sideIdx, sideTotalMap[s]);
                                if (borderCell) {
                                    cellMap[borderNode.id] = borderCell;
                                }
                            });
                        }
                    }
                    return cell;
                }

                nodes.forEach((node) => ensureCell(node));

                // ELK가 이미 compound node 크기와 상대 좌표를 계산한 경우에는
                // 렌더 단계에서 부모/자식 좌표를 다시 움직이지 않는다.
                if (!hasElkGeometry(nodes)) {
                    resizeParentsToFitChildren(graph, parent, cellMap, nodes);
                }

                edges.forEach(edge => {
                    _createEdge(graph, parent, edge, cellMap, borderNodeIds);
                });

                log('렌더링 완료. 생성된 셀:', Object.keys(cellMap).length);
            }
        } finally {
            graphModel.endUpdate();
            if (typeof ns.MxGraph._setRendering === 'function') ns.MxGraph._setRendering(false);
        }

        if (!hasVisibleNodes) {
            graph.refresh();
            showEmptyStateOverlay(graph);
            ns.MxGraph.history?.clear?.();
            return;
        }

        _distributeOverlappingEdges(graph);
        graph.refresh();
        hideEmptyStateOverlay(graph);

        // 그래프 재구축 작업이 undo 스택에 남지 않도록 클리어
        ns.MxGraph.history?.clear?.();
    }

    /**
     * 그래프 초기화 및 모델 렌더링
     * @param {HTMLElement} container - 컨테이너 요소
     * @param {Object} model - 정규화된 모델
     * @returns {mxGraph} 생성된 그래프
     */
    function initAndRender(container, model) {
        const graph = ns.MxGraph.init?.(container);
        if (!graph) {
            log('그래프 초기화 실패');
            return null;
        }

        ns.MxGraph.styles?.registerStyles?.(graph);

        if (model) {
            renderModel(graph, model);
        }

        return graph;
    }

    // Export
    ns.MxGraph.factory.renderModel = renderModel;
    ns.MxGraph.factory.initAndRender = initAndRender;

    Object.defineProperty(ns.MxGraph.factory, 'formatLabel', {
        get: () => ns.MxGraph.labelUtils?.formatLabel
    });

    log('MxCellFactory 모듈 로드 완료');
})();
