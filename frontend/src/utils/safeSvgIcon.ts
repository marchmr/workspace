const ALLOWED_TAGS = new Set([
    'svg',
    'g',
    'path',
    'circle',
    'rect',
    'line',
    'polyline',
    'polygon',
    'ellipse',
    'title',
    'desc',
]);

const ALLOWED_ATTRS = new Set([
    'xmlns',
    'viewBox',
    'width',
    'height',
    'fill',
    'stroke',
    'stroke-width',
    'stroke-linecap',
    'stroke-linejoin',
    'stroke-miterlimit',
    'stroke-dasharray',
    'stroke-dashoffset',
    'x',
    'y',
    'x1',
    'x2',
    'y1',
    'y2',
    'cx',
    'cy',
    'r',
    'rx',
    'ry',
    'points',
    'd',
    'transform',
    'focusable',
    'aria-hidden',
    'role',
    'class',
]);

function isSafeAttributeName(name: string): boolean {
    const lower = name.toLowerCase();
    if (lower.startsWith('on')) return false;
    if (lower === 'href' || lower === 'xlink:href') return false;
    return ALLOWED_ATTRS.has(name) || ALLOWED_ATTRS.has(lower);
}

function sanitizeNode(node: Element): boolean {
    const tagName = node.tagName.toLowerCase();
    if (!ALLOWED_TAGS.has(tagName)) {
        node.remove();
        return false;
    }

    for (const attr of Array.from(node.attributes)) {
        if (!isSafeAttributeName(attr.name)) {
            node.removeAttribute(attr.name);
            continue;
        }
        if (/[<>]/.test(attr.value)) {
            node.removeAttribute(attr.name);
        }
    }

    for (const child of Array.from(node.children)) {
        sanitizeNode(child);
    }
    return true;
}

export function sanitizeSvgIcon(input: string | null | undefined): string {
    const raw = String(input || '').trim();
    if (!raw) return '';
    if (raw.length > 20_000) return '';

    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(raw, 'image/svg+xml');
        const svg = doc.documentElement;
        if (!svg || svg.tagName.toLowerCase() !== 'svg') return '';
        if (doc.querySelector('parsererror')) return '';
        if (!sanitizeNode(svg)) return '';
        return new XMLSerializer().serializeToString(svg);
    } catch {
        return '';
    }
}
