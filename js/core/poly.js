/** 多边形栅格化与 IoU，用于实例去重（与 Python 参考实现的 rast/iou 对应） */

/**
 * 扫描线填充多边形，返回位掩码。
 * @param {Float64Array|number[]} xs 顶点 x
 * @param {Float64Array|number[]} ys 顶点 y
 */
function rasterize(xs, ys) {
  const n = xs.length
  let minX = xs[0]
  let maxX = xs[0]
  let minY = ys[0]
  let maxY = ys[0]
  for (let i = 1; i < n; i++) {
    if (xs[i] < minX) minX = xs[i]
    if (xs[i] > maxX) maxX = xs[i]
    if (ys[i] < minY) minY = ys[i]
    if (ys[i] > maxY) maxY = ys[i]
  }
  const x0 = Math.floor(minX)
  const y0 = Math.floor(minY)
  const w = Math.max(Math.ceil(maxX) + 1 - x0, 1)
  const h = Math.max(Math.ceil(maxY) + 1 - y0, 1)
  const mask = new Uint8Array(w * h)
  const px = new Float64Array(n)
  const py = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    px[i] = Math.round(xs[i]) - x0
    py[i] = Math.round(ys[i]) - y0
  }
  const crossings = new Float64Array(n)
  let area = 0
  for (let y = 0; y < h; y++) {
    let count = 0
    let j = n - 1
    for (let i = 0; i < n; i++) {
      const yi = py[i]
      const yj = py[j]
      if ((yi <= y && yj > y) || (yj <= y && yi > y)) {
        crossings[count++] = px[i] + ((y - yi) * (px[j] - px[i])) / (yj - yi)
      }
      j = i
    }
    if (count < 2) continue
    const sorted = Array.prototype.slice.call(crossings, 0, count).sort(function (a, b) {
      return a - b
    })
    for (let k = 0; k + 1 < count; k += 2) {
      let from = Math.ceil(sorted[k] - 0.5)
      let to = Math.floor(sorted[k + 1] + 0.5)
      if (from < 0) from = 0
      if (to > w - 1) to = w - 1
      const row = y * w
      for (let x = from; x <= to; x++) {
        if (mask[row + x] === 0) {
          mask[row + x] = 1
          area++
        }
      }
    }
  }
  return { x: x0, y: y0, w: w, h: h, mask: mask, area: area }
}

/** 两个栅格掩码的 IoU */
function iou(a, b) {
  const x0 = Math.max(a.x, b.x)
  const y0 = Math.max(a.y, b.y)
  const x1 = Math.min(a.x + a.w, b.x + b.w)
  const y1 = Math.min(a.y + a.h, b.y + b.h)
  if (x1 <= x0 || y1 <= y0) return 0
  let inter = 0
  for (let y = y0; y < y1; y++) {
    const ra = (y - a.y) * a.w - a.x
    const rb = (y - b.y) * b.w - b.x
    for (let x = x0; x < x1; x++) {
      if (a.mask[ra + x] === 1 && b.mask[rb + x] === 1) inter++
    }
  }
  if (inter === 0) return 0
  return inter / (a.area + b.area - inter)
}

export default { rasterize: rasterize, iou: iou }
