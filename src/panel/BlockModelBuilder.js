/*******************************************************************************
 * Copyright: SELab.AI (c) 2026
 *******************************************************************************/

const BLOCK_NODE_KINDS = new Set([
    'package',
    'librarypackage',
    'partdefinition',
    'partusage',
    'portdefinition',
    'portusage',
    'attributedefinition',
    'attributeusage',
    'interfacedefinition',
    'interfaceusage',
]);

const BLOCK_EDGE_KINDS = new Set([
    'containment',
    'specialization',
    'inheritance',
    'generalization',
    'association',
    'allocation',
    'dependency',
    'featuretyping',
    'typefeaturing',
    'subsetting',
    'redefinition',
    'connection',
    'binding',
]);

function normalizeText(value, fallback = '') {
    return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function normalizeKind(value) {
    return normalizeText(value).toLowerCase();
}

function normalizeEdgeKind(edge) {
    return normalizeKind(edge?.kind || edge?.type);
}

function getNodeKey(node) {
    return normalizeText(node?.id, normalizeText(node?.qualifiedName, normalizeText(node?.name)));
}

function isBlockNode(node) {
    const kind = normalizeKind(node?.kind || node?.type);
    return BLOCK_NODE_KINDS.has(kind);
}

function isUsageNode(node) {
    const kind = normalizeKind(node?.kind || node?.type);
    return kind.endsWith('usage');
}

function isBlockEdge(edge) {
    return BLOCK_EDGE_KINDS.has(normalizeEdgeKind(edge));
}

function buildLookup(nodes) {
    const nodeByKey = new Map();
    const aliasMap = new Map();

    function addAlias(alias, key) {
        const normalizedAlias = normalizeText(alias);
        if (!normalizedAlias || !key) {
            return;
        }
        const existing = aliasMap.get(normalizedAlias) || new Set();
        existing.add(key);
        aliasMap.set(normalizedAlias, existing);
    }

    for (const node of nodes) {
        const key = getNodeKey(node);
        if (!key || nodeByKey.has(key)) {
            continue;
        }
        nodeByKey.set(key, node);
        addAlias(key, key);
        addAlias(node.id, key);
        addAlias(node.qualifiedName, key);
        addAlias(node.name, key);
        addAlias(node.declaredName, key);
    }

    function resolveNodeKey(value) {
        const candidate = normalizeText(value);
        if (!candidate) {
            return '';
        }
        if (nodeByKey.has(candidate)) {
            return candidate;
        }
        const exactMatches = aliasMap.get(candidate);
        if (exactMatches?.size === 1) {
            return Array.from(exactMatches)[0];
        }

        const unquoted = candidate.replace(/^['"]|['"]$/g, '');
        if (nodeByKey.has(unquoted)) {
            return unquoted;
        }
        const unquotedMatches = aliasMap.get(unquoted);
        if (unquotedMatches?.size === 1) {
            return Array.from(unquotedMatches)[0];
        }

        return '';
    }

    return {
        nodeByKey,
        resolveNodeKey,
    };
}

function extractExplicitParent(node) {
    const rawParent = node?.parent || node?.container || node?.package || node?.owner || node?.namespace;
    if (typeof rawParent === 'object' && rawParent !== null) {
        return normalizeText(rawParent.id, normalizeText(rawParent.qualifiedName, normalizeText(rawParent.name)));
    }
    return normalizeText(rawParent);
}

function buildDirectParentMap(nodes, edges, resolveNodeKey) {
    const directParentMap = new Map();

    for (const edge of edges) {
        if (normalizeEdgeKind(edge) !== 'containment') {
            continue;
        }
        const sourceKey = resolveNodeKey(edge.source);
        const targetKey = resolveNodeKey(edge.target);
        if (!sourceKey || !targetKey || sourceKey === targetKey) {
            continue;
        }
        directParentMap.set(targetKey, sourceKey);
    }

    for (const node of nodes) {
        const nodeKey = getNodeKey(node);
        if (!nodeKey || directParentMap.has(nodeKey)) {
            continue;
        }
        const explicitParent = resolveNodeKey(extractExplicitParent(node));
        if (explicitParent && explicitParent !== nodeKey) {
            directParentMap.set(nodeKey, explicitParent);
            continue;
        }

        let candidate = nodeKey;
        while (candidate.includes('::')) {
            candidate = candidate.substring(0, candidate.lastIndexOf('::'));
            const resolvedCandidate = resolveNodeKey(candidate);
            if (resolvedCandidate && resolvedCandidate !== nodeKey) {
                directParentMap.set(nodeKey, resolvedCandidate);
                break;
            }
        }
    }

    return directParentMap;
}

function wouldCreateParentCycle(childKey, parentKey, directParentMap) {
    const visited = new Set([childKey]);
    let cursor = parentKey;

    while (cursor) {
        if (visited.has(cursor)) {
            return true;
        }
        visited.add(cursor);
        cursor = directParentMap.get(cursor) || '';
    }

    return false;
}

function inferFeatureTypingParents(edges, directParentMap, resolveNodeKey, nodeByKey) {
    for (let pass = 0; pass < nodeByKey.size; pass++) {
        let changed = false;

        for (const edge of edges) {
            const edgeKind = normalizeEdgeKind(edge);
            if (edgeKind !== 'featuretyping' && edgeKind !== 'typefeaturing') {
                continue;
            }

            const sourceKey = resolveNodeKey(edge.source);
            const targetKey = resolveNodeKey(edge.target);
            if (!sourceKey || !targetKey || sourceKey === targetKey || directParentMap.has(sourceKey)) {
                continue;
            }

            const sourceNode = nodeByKey.get(sourceKey);
            if (!sourceNode || !isUsageNode(sourceNode)) {
                continue;
            }

            const targetParentKey = directParentMap.get(targetKey) || '';
            if (!targetParentKey || targetParentKey === sourceKey) {
                continue;
            }
            if (wouldCreateParentCycle(sourceKey, targetParentKey, directParentMap)) {
                continue;
            }

            directParentMap.set(sourceKey, targetParentKey);
            changed = true;
        }

        if (!changed) {
            break;
        }
    }
}

function findNearestKeptAncestor(nodeKey, keptNodeKeys, directParentMap, resolveNodeKey) {
    const visited = new Set([nodeKey]);
    let cursor = directParentMap.get(nodeKey) || '';

    while (cursor && !visited.has(cursor)) {
        if (keptNodeKeys.has(cursor)) {
            return cursor;
        }
        visited.add(cursor);
        cursor = directParentMap.get(cursor) || '';
    }

    let qualifiedCursor = nodeKey;
    while (qualifiedCursor.includes('::')) {
        qualifiedCursor = qualifiedCursor.substring(0, qualifiedCursor.lastIndexOf('::'));
        const resolvedCandidate = resolveNodeKey(qualifiedCursor);
        if (resolvedCandidate && keptNodeKeys.has(resolvedCandidate) && resolvedCandidate !== nodeKey) {
            return resolvedCandidate;
        }
    }

    return '';
}

function deduplicateEdges(edges) {
    const edgeMap = new Map();

    for (const edge of edges) {
        const key = [normalizeText(edge.source), normalizeText(edge.target), normalizeEdgeKind(edge), normalizeText(edge.label)].join('|');
        if (!edgeMap.has(key)) {
            edgeMap.set(key, edge);
        }
    }

    return Array.from(edgeMap.values());
}

function buildBlockModel(model) {
    const rawNodes = Array.isArray(model?.nodes) ? model.nodes : [];
    const rawEdges = Array.isArray(model?.edges) ? model.edges : [];
    const { nodeByKey, resolveNodeKey } = buildLookup(rawNodes);
    const directParentMap = buildDirectParentMap(rawNodes, rawEdges, resolveNodeKey);
    inferFeatureTypingParents(rawEdges, directParentMap, resolveNodeKey, nodeByKey);
    const keptNodeKeys = new Set();

    for (const node of rawNodes) {
        const nodeKey = getNodeKey(node);
        if (nodeKey && nodeByKey.has(nodeKey) && isBlockNode(node)) {
            keptNodeKeys.add(nodeKey);
        }
    }

    const filteredNodes = [];
    for (const nodeKey of keptNodeKeys) {
        const rawNode = nodeByKey.get(nodeKey);
        if (!rawNode) {
            continue;
        }

        const nextNode = {
            ...rawNode,
            id: nodeKey,
        };
        const parentKey = findNearestKeptAncestor(nodeKey, keptNodeKeys, directParentMap, resolveNodeKey);
        if (parentKey) {
            nextNode.parent = parentKey;
        } else {
            delete nextNode.parent;
        }
        filteredNodes.push(nextNode);
    }

    const filteredEdges = [];
    for (const edge of rawEdges) {
        const edgeKind = normalizeEdgeKind(edge);
        if (!isBlockEdge(edge) || edgeKind === 'containment') {
            continue;
        }

        const sourceKey = resolveNodeKey(edge.source);
        const targetKey = resolveNodeKey(edge.target);
        if (!keptNodeKeys.has(sourceKey) || !keptNodeKeys.has(targetKey) || sourceKey === targetKey) {
            continue;
        }

        filteredEdges.push({
            ...edge,
            source: sourceKey,
            target: targetKey,
            kind: edge.kind || edge.type || edgeKind,
            type: edge.type || edge.kind || edgeKind,
        });
    }

    for (const node of filteredNodes) {
        if (!node.parent) {
            continue;
        }
        filteredEdges.push({
            id: `block-containment:${node.parent}->${node.id}`,
            source: node.parent,
            target: node.id,
            kind: 'containment',
            type: 'containment',
        });
    }

    return {
        nodes: filteredNodes,
        edges: deduplicateEdges(filteredEdges),
    };
}

module.exports = {
    buildBlockModel,
};
