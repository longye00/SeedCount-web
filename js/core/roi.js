/**
 * 手动计数区域。单区域保持原格式：
 * { tool: 'rect'|'circle'|'polygon'|'freehand', points: [{x,y}, ...] }
 * 多区域使用：
 * { tool: 'multi', regions: [单区域, ...] }
 */

function radius(region) {
  const points = region && region.points
  if (!points || points.length < 2) return 0
  return Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y)
}

function singleBounds(region) {
  const points = region && region.points
  if (!points || !points.length) return { left: 0, top: 0, right: 0, bottom: 0 }
  if (region.tool === 'circle' && points.length >= 2) {
    const r = radius(region)
    return {
      left: points[0].x - r,
      top: points[0].y - r,
      right: points[0].x + r,
      bottom: points[0].y + r,
    }
  }
  let left = points[0].x
  let top = points[0].y
  let right = points[0].x
  let bottom = points[0].y
  for (let index = 1; index < points.length; index++) {
    if (points[index].x < left) left = points[index].x
    if (points[index].y < top) top = points[index].y
    if (points[index].x > right) right = points[index].x
    if (points[index].y > bottom) bottom = points[index].y
  }
  return { left: left, top: top, right: right, bottom: bottom }
}

function isSingleUsable(region) {
  if (!region || region.tool === 'multi' || !region.points) return false
  const bound = singleBounds(region)
  const largeEnough = bound.right - bound.left > 8 && bound.bottom - bound.top > 8
  if (region.tool === 'rect' || region.tool === 'circle') {
    return region.points.length >= 2 && largeEnough
  }
  return region.points.length >= 3 && largeEnough
}

function regions(roi) {
  if (!roi) return []
  if (roi.tool === 'multi') {
    return Array.isArray(roi.regions) ? roi.regions.filter(isSingleUsable) : []
  }
  return isSingleUsable(roi) ? [roi] : []
}

function isUsable(roi) {
  return regions(roi).length > 0
}

function bounds(roi) {
  const list = regions(roi)
  if (!list.length) return { left: 0, top: 0, right: 0, bottom: 0 }
  const first = singleBounds(list[0])
  const result = { left: first.left, top: first.top, right: first.right, bottom: first.bottom }
  for (let index = 1; index < list.length; index++) {
    const next = singleBounds(list[index])
    if (next.left < result.left) result.left = next.left
    if (next.top < result.top) result.top = next.top
    if (next.right > result.right) result.right = next.right
    if (next.bottom > result.bottom) result.bottom = next.bottom
  }
  return result
}

function containsSingle(region, x, y) {
  if (region.tool === 'rect') {
    const bound = singleBounds(region)
    return x >= bound.left && x <= bound.right && y >= bound.top && y <= bound.bottom
  }
  if (region.tool === 'circle') {
    return Math.hypot(x - region.points[0].x, y - region.points[0].y) <= radius(region)
  }
  const points = region.points
  let inside = false
  let previous = points.length - 1
  for (let index = 0; index < points.length; index++) {
    const xi = points[index].x
    const yi = points[index].y
    const xj = points[previous].x
    const yj = points[previous].y
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-9) + xi) inside = !inside
    previous = index
  }
  return inside
}

/** 原图坐标点是否落在任一区域内 */
function contains(roi, x, y) {
  const list = regions(roi)
  if (!list.length) return true
  for (let index = 0; index < list.length; index++) {
    if (containsSingle(list[index], x, y)) return true
  }
  return false
}

function singleStroke(region, scale, offsetX, offsetY) {
  const px = (value) => (value - offsetX) * scale
  const py = (value) => (value - offsetY) * scale
  if (region.tool === 'rect') {
    const bound = singleBounds(region)
    return {
      type: 'rect',
      x: px(bound.left),
      y: py(bound.top),
      w: (bound.right - bound.left) * scale,
      h: (bound.bottom - bound.top) * scale,
    }
  }
  if (region.tool === 'circle') {
    return {
      type: 'circle',
      x: px(region.points[0].x),
      y: py(region.points[0].y),
      r: radius(region) * scale,
    }
  }
  return {
    type: 'polygon',
    points: region.points.map((point) => ({ x: px(point.x), y: py(point.y) })),
  }
}

/** 生成所有区域在分析画布上的描边形状 */
function strokeShapes(roi, scale, offsetX, offsetY) {
  return regions(roi).map((region) => singleStroke(region, scale, offsetX, offsetY))
}

/** 兼容旧调用：返回第一个区域的描边形状 */
function strokePoints(roi, scale, offsetX, offsetY) {
  const shapes = strokeShapes(roi, scale, offsetX, offsetY)
  return shapes.length ? shapes[0] : null
}

export default {
  bounds: bounds,
  radius: radius,
  regions: regions,
  isUsable: isUsable,
  contains: contains,
  strokePoints: strokePoints,
  strokeShapes: strokeShapes,
}