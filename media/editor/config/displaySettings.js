/* ********************************************************************************
 * Copyright: SELab.AI (c) 2026
 * WebView용 표시 설정 - 모든 레이아웃/렌더링 상수의 단일 진실 공급원 (Single Source of Truth)
 *
 * [목적]
 *   여러 파일(metrics.js, layout.js, elkLayout.js, alignRanks.js, drawElement.js,
 *   drawContainerHeader.js, MxCompartmentRenderer.js, MxCellFactory.js, MxDragHandler.js)에
 *   흩어져 있던 하드코딩 숫자들을 한 곳에서 관리하기 위한 중앙집중식 설정 파일.
 *
 * [사용법]
 *   const DS = window.SELAB.Editor.config.displaySettings;
 *   const value = DS.label.lineHeight;  // 14
 * ********************************************************************************/
(function () {
    'use strict';

    const ns = (window.SELAB = window.SELAB || {});
    ns.Editor = ns.Editor || {};
    ns.Editor.config = ns.Editor.config || {};

    ns.Editor.config.displaySettings = {

        // ─── 스타일 ───────────────────────────────────────────────
        // Usage 노드의 모서리 라운드 크기 (픽셀 단위)
        usageRoundedCornerSize: 18,

        // ─── 폰트 ────────────────────────────────────────────────
        font: {
            family: 'sans-serif',
            size: 12,                      // 기본 폰트 크기 (px)
            mxDefault: '11px Arial',       // mxGraph 기본 폰트
        },

        // ─── 노드 사전계산 크기 (layout.js precomputeNodeSizes) ──
        nodePrecompute: {
            minWidth: 120,                 // 노드 최소 폭
            maxWidth: 250,                 // 노드 최대 폭 제한
            paddingX: 24,                  // 좌우 텍스트 패딩
            lineHeight: 16,                // 줄 높이 (px)
            verticalPadding: 30,           // 상하 패딩
            defaultHeight: 40,             // 기본 높이
            charWidthEstimate: 7,          // 텍스트 측정 불가 시 1글자당 추정 폭 (px)
        },

        // ─── 특수 노드 고정 크기 ─────────────────────────────────
        specialNode: {
            terminateAction:    { width: 120, height: 80 },
            forkNode:           { width: 12,  height: 60, renderedWidth: 80, renderedHeight: 20 },
            decisionNode:       { width: 72,  height: 72 },
            startAction:        { width: 28,  height: 28 },
            startFinalizeCircle:{ width: 40,  height: 40 },
            doneAction:         { width: 34,  height: 34 },
            containerDefault:   { width: 200, height: 150 },
        },

        // ─── 라벨 메트릭 (metrics.js LABEL_METRICS) ─────────────
        label: {
            lineHeight: 14,                // 라벨 텍스트 라인당 높이 (fontSize=12 기준)
            paddingVertical: 16,           // 상하 패딩 (실제 렌더링 기준)
            minHeight: 30,                 // 최소 높이 (실제 렌더링 기준)
        },

        // ─── Compartment 메트릭 (metrics.js COMPARTMENT_METRICS) ─
        compartment: {
            separatorHeight: 9,            // 구분선(hr) 높이 (margin 4px + border 1px + margin 4px)
            headerHeight: 20,              // Compartment 헤더 높이 (mxGraph 실제 렌더링 값)
            headerPadding: 2,              // 헤더 추가 패딩
            itemHeight: 16,                // Compartment 아이템당 높이 (mxGraph 실제 렌더링 값)
            margin: 8,                     // Compartment 간 여백
            textPadding: 16,               // Compartment 텍스트 패딩 (줄바꿈 계산용)
        },

        // ─── 컨테이너 메트릭 (metrics.js CONTAINER_METRICS) ──────
        container: {
            paddingTop: 16,                // 상단 패딩
            paddingRight: 16,              // 우측 패딩
            paddingBottom: 16,             // 하단 패딩
            paddingLeft: 16,               // 좌측 패딩
            minWidth: 120,                 // 최소 너비
        },

        // ─── Border Node 메트릭 ──────────────────────────────────
        borderNode: {
            size: 12,                      // Border node 고정 크기
            spacingTop: 2,                 // mxGraph 라벨 상단 간격
            spacingBottom: 2,              // mxGraph 라벨 하단 간격
            minSpacing: 16,               // 보더노드 간 최소 간격 (px)
            sideMargin: 16,               // 노드 가장자리~첫/마지막 보더노드 여백 (px)
        },

        // ─── FreeForm Compartment 메트릭 (action flow, parts 등) ─
        freeform: {
            // SVG 렌더러용
            nodeWidth: 120,                // 노드 기본 너비
            nodeHeight: 40,                // 노드 기본 높이
            actionFlowSpacing: 50,         // action flow 아이템 간 간격 (화살표 공간)
            partsSpacing: 8,               // parts 아이템 간 간격 (화살표 없음)
            startXOffset: 20,              // 시작 X 오프셋
            // mxGraph 렌더러용
            mxActionFlowGap: 20,           // mxGraph action flow 아이템 간 간격
            mxPartsGap: 8,                 // mxGraph parts 아이템 간 간격
            mxCircleSize: 16,              // Start/Done 노드 원 크기
            mxHeaderHeight: 18,            // compartment 헤더 높이
            // 공통
            lineHeight: 14,                // 텍스트 라인 높이
            bottomPadding: 4,              // 하단 여백 (최소화)
        },

        // ─── ELK 레이아웃 설정 (elkLayout.js) ────────────────────
        elk: {
            // 알고리즘
            algorithm: 'layered',
            direction: 'DOWN',
            edgeRouting: 'ORTHOGONAL',
            hierarchyHandling: 'INCLUDE_CHILDREN',
            nodePlacement: 'NETWORK_SIMPLEX',
            crossingMinimization: 'LAYER_SWEEP',
            modelOrderStrategy: 'NODES_AND_EDGES',
            compactionStrategy: 'EDGE_LENGTH',
            // 간격
            nodeNodeSpacing: 40,           // 동일 레이어 내 노드 간 간격
            nodeNodeBetweenLayers: 40,    // 레이어 사이 노드 간 간격
            componentComponentSpacing: 35, // 연결 컴포넌트 간 간격 (엣지 없는 독립 노드 그룹 사이)
            edgeNodeBetweenLayers: 15,     // 레이어 사이 엣지-노드 간 간격
            edgeNodeSpacing: 15,           // 동일 레이어 내 엣지-노드 간 간격
            edgeEdgeSpacing: 15,           // 엣지-엣지 간 최소 간격
            edgeEdgeBetweenLayers: 15,     // 레이어 간 엣지-엣지 간격
            thoroughness: 7,               // 레이아웃 품질 (높을수록 정확)
            mergeEdges: false,             // 같은 방향 엣지 병합
            mergeHierarchyEdges: false,    // 계층 엣지 병합
            compactConnectedComponents: true, // 연결된 컴포넌트 압축
            // 컨테이너 내부 간격 (actor 등 엣지 없는 자식 노드 간 세로 간격)
            containerChildSpacing: 20,
            // 컨테이너 내부 패딩
            containerPadding: {
                top: 44,                   // 기본 상단 패딩
                left: 24,                  // 좌측 패딩
                right: 24,                 // 우측 패딩
                bottom: 24,                // 기본 하단 패딩
                ifActionTop: 90,           // IfAction 상단 패딩 (조건 라벨 공간)
                whileLoopBottom: 70,       // WhileLoop 하단 패딩 (until 조건 공간)
            },
            // 부모 컨테이너 후처리 패딩
            parentContainerPadding: 20,
        },

        // ─── 정렬 설정 (alignRanks.js) ───────────────────────────
        alignment: {
            elkSpacingTolerance: 20,       // ELK spacing 존중 허용 오차 (px)
        },

        // ─── SVG 렌더링 설정 (drawElement.js, drawContainerHeader.js) ─
        render: {
            paddingX: 8,                   // 컨테이너/컴파트먼트 좌우 여백
            lineHeight: 14,                // 텍스트 라인 높이
            leafPaddingX: 12,              // 리프 노드 좌우 여백
            leafPaddingY: 10,              // 리프 노드 상하 여백
        },

        // ─── 그리드/폴백 설정 ────────────────────────────────────
        grid: {
            size: 10,                      // 그리드 스냅 크기
            // ELK 폴백 그리드 (elkLayout.js fallbackGrid)
            fallback: {
                paddingX: 150,             // X축 간격 (수평)
                paddingY: 58,              // Y축 간격 (수직)
                elementWidth: 120,         // 기본 노드 폭
                elementHeight: 80,         // 기본 노드 높이
                innerPadding: 60,          // 자식 노드 내부 패딩
            },
            // 단순 그리드 (layout.js grid)
            simple: {
                padding: 50,               // 기본 간격
                elementWidth: 120,         // 기본 노드 폭
                elementHeight: 80,         // 기본 노드 높이
            },
        },

        // ─── mxGraph Action Flow 렌더링 (MxCompartmentRenderer.js) ─
        mxActionFlow: {
            nodeHeaderHeight: 40,          // 노드 헤더 높이
            hrHeight: 8,                   // <hr> 높이
            actionFlowHeaderHeight: 24,    // "action flow" 글자 + padding
            itemHeight: 40,                // 아이템 높이
            itemSpacing: 10,               // 아이템 간 간격
            itemMarginX: 10,               // 아이템 좌측 여백
            startCircleSize: 20,           // StartAction 원 크기
            doneCircleSize: 24,            // DoneAction 원 크기
            // addFreeformCells 상수
            cellNodeWidth: 140,            // freeform 셀 노드 폭
            cellNodeHeight: 36,            // freeform 셀 노드 높이
            cellCircleSize: 16,            // freeform 셀 원 크기
            cellSpacing: 40,               // freeform 셀 간 간격
        },

        // ─── mxGraph CellFactory (MxCellFactory.js) ──────────────
        mxCellFactory: {
            loopBodyStartY: 40,            // 루프 body 시작 Y
            attributeItemHeight: 18,       // 속성 아이템 높이
            attributeHeaderHeight: 20,     // 속성 헤더 높이
        },
    };

})();
