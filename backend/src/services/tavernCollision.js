/**
 * services/tavernCollision.js
 *
 * Colisão pura da Taverna: polígono andável + obstáculos (mesas, balcão,
 * mesa de bilhar, piano). Mesma lógica usada no cliente (predição local,
 * em experiments/tavern/src/engine/collision.ts) — aqui ela é a fonte
 * AUTORITATIVA: o cliente só prevê, o servidor decide.
 *
 * Sem dependência de banco nem de nada Fastify-específico — funções puras,
 * fáceis de testar isoladas (ver tests/tavernRoom.test.js).
 */

/**
 * Carrega o mapa de colisão (JSON com coordenadas em frações 0..1 da
 * imagem de fundo) e converte para pixels reais da imagem, usando
 * imageWidth/imageHeight do próprio arquivo.
 *
 * @param {object} raw - conteúdo de tavernCollision.json
 * @returns {object} CollisionMap em espaço de pixel
 */
export function loadCollisionMap(raw) {
  const { imageWidth: w, imageHeight: h } = raw;
  return {
    mapId: raw.mapId,
    imageWidth: w,
    imageHeight: h,
    walkableArea: {
      type: 'polygon',
      points: raw.walkableArea.points.map(([fx, fy]) => [fx * w, fy * h]),
    },
    obstacles: raw.obstacles.map((shape) => toObstaclePx(shape, w, h)),
  };
}

function toObstaclePx(shape, w, h) {
  switch (shape.type) {
    case 'rect':
      return {
        type: 'rect',
        x: shape.x * w,
        y: shape.y * h,
        width: shape.width * w,
        height: shape.height * h,
      };
    case 'circle':
      // raio em pixels usa a largura da imagem como referência única, pro
      // círculo continuar circular no espaço em pixels (que é isotrópico).
      return { type: 'circle', cx: shape.cx * w, cy: shape.cy * h, radius: shape.radius * w };
    case 'polygon':
      return { type: 'polygon', points: shape.points.map(([fx, fy]) => [fx * w, fy * h]) };
    default:
      throw new Error(`tipo de obstaculo desconhecido: ${shape.type}`);
  }
}

function pointInPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    const intersects = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function distToSegment(x, y, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((x - ax) * dx + (y - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const px = ax + t * dx;
  const py = ay + t * dy;
  return Math.hypot(x - px, y - py);
}

function distToPolygonEdges(x, y, points) {
  let min = Infinity;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [ax, ay] = points[j];
    const [bx, by] = points[i];
    min = Math.min(min, distToSegment(x, y, ax, ay, bx, by));
  }
  return min;
}

function circleInsidePolygon(cx, cy, r, poly) {
  if (!pointInPolygon(cx, cy, poly.points)) return false;
  return distToPolygonEdges(cx, cy, poly.points) >= r;
}

function circleIntersectsRect(cx, cy, r, rect) {
  const nearestX = Math.max(rect.x, Math.min(cx, rect.x + rect.width));
  const nearestY = Math.max(rect.y, Math.min(cy, rect.y + rect.height));
  return Math.hypot(cx - nearestX, cy - nearestY) < r;
}

function circleIntersectsCircle(cx, cy, r, other) {
  return Math.hypot(cx - other.cx, cy - other.cy) < r + other.radius;
}

function circleIntersectsPolygon(cx, cy, r, poly) {
  if (pointInPolygon(cx, cy, poly.points)) return true;
  return distToPolygonEdges(cx, cy, poly.points) < r;
}

function circleIntersectsObstacle(cx, cy, r, obstacle) {
  switch (obstacle.type) {
    case 'rect': return circleIntersectsRect(cx, cy, r, obstacle);
    case 'circle': return circleIntersectsCircle(cx, cy, r, obstacle);
    case 'polygon': return circleIntersectsPolygon(cx, cy, r, obstacle);
    default: return false;
  }
}

/** Ponto (com raio de colisão) é válido: dentro da área andável e livre de obstáculos. */
export function isBlocked(map, x, y, radius) {
  if (!circleInsidePolygon(x, y, radius, map.walkableArea)) return true;
  return map.obstacles.some((o) => circleIntersectsObstacle(x, y, radius, o));
}

/**
 * Resolve movimento simples: tenta o destino completo; se bloqueado,
 * desliza só no eixo X ou só no eixo Y; se nada funcionar, fica parado
 * (retorna literalmente o objeto `from`, para o chamador detectar
 * "bloqueio total" por igualdade de referência).
 */
export function resolveMovement(map, from, to, radius) {
  if (!isBlocked(map, to.x, to.y, radius)) return to;

  const slideX = { x: to.x, y: from.y };
  if (!isBlocked(map, slideX.x, slideX.y, radius)) return slideX;

  const slideY = { x: from.x, y: to.y };
  if (!isBlocked(map, slideY.x, slideY.y, radius)) return slideY;

  return from;
}
