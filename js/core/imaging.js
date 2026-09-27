/**
 * 纯 JavaScript 图像处理，与 Android 版 SeedLocator 一一对应。
 * 不依赖任何 wx API，小程序与 Node 共用同一份代码。
 */

/** RGBA -> 灰度，系数与 Android 端完全一致 */
function toGray(rgba, w, h) {
  const gray = new Uint8Array(w * h)
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = (rgba[p] * 4899 + rgba[p + 1] * 9617 + rgba[p + 2] * 1868) >> 14
  }
  return gray
}

/** 整数倍区域平均下采样（等价 cv2.INTER_AREA） */
function shrinkBlock(gray, w, h, f) {
  const sw = Math.max((w / f) | 0, 1)
  const sh = Math.max((h / f) | 0, 1)
  const small = new Int32Array(sw * sh)
  for (let y = 0; y < sh; y++) {
    const y0 = y * f
    const y1 = Math.min(y0 + f, h)
    for (let x = 0; x < sw; x++) {
      const x0 = x * f
      const x1 = Math.min(x0 + f, w)
      let sum = 0
      let count = 0
      for (let yy = y0; yy < y1; yy++) {
        const row = yy * w
        for (let xx = x0; xx < x1; xx++) {
          sum += gray[row + xx]
          count++
        }
      }
      small[y * sw + x] = count === 0 ? 0 : (sum / count) | 0
    }
  }
  return { data: small, w: sw, h: sh }
}

/** 单调队列滑动最大/最小，O(n)。horizontal=true 按行，否则按列。 */
function slide(src, dst, w, h, radius, horizontal, maximum) {
  const n = horizontal ? w : h
  const lines = horizontal ? h : w
  const deque = new Int32Array(n)
  for (let line = 0; line < lines; line++) {
    const offset = horizontal ? line * w : line
    const stride = horizontal ? 1 : w
    let head = 0
    let tail = 0
    let next = 0
    for (let i = 0; i < n; i++) {
      const hi = Math.min(n - 1, i + radius)
      while (next <= hi) {
        const value = src[offset + next * stride]
        while (tail > head) {
          const previous = src[offset + deque[tail - 1] * stride]
          if (maximum ? previous <= value : previous >= value) tail--
          else break
        }
        deque[tail++] = next
        next++
      }
      const lo = Math.max(0, i - radius)
      while (deque[head] < lo) head++
      dst[offset + i * stride] = src[offset + deque[head] * stride]
    }
  }
}

/** 5x5 中值滤波 */
function median5(src, w, h) {
  const out = new Int32Array(w * h)
  const win = new Int32Array(25)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let count = 0
      for (let dy = -2; dy <= 2; dy++) {
        const yy = Math.min(Math.max(y + dy, 0), h - 1)
        for (let dx = -2; dx <= 2; dx++) {
          const xx = Math.min(Math.max(x + dx, 0), w - 1)
          win[count++] = src[yy * w + xx]
        }
      }
      for (let i = 1; i < 25; i++) {
        const key = win[i]
        let j = i - 1
        while (j >= 0 && win[j] > key) {
          win[j + 1] = win[j]
          j--
        }
        win[j + 1] = key
      }
      out[y * w + x] = win[12]
    }
  }
  return out
}

/**
 * 形态学闭运算估计局部背景亮度（1/4 尺寸计算，使用时双线性放大）。
 * bright = 局部背景亮度 95 分位，作为「纸面亮度」的稳健估计。
 */
function localBackground(gray, w, h) {
  const f = 4
  const small = shrinkBlock(gray, w, h, f)
  let k = Math.round((0.035 * Math.max(w, h)) / f)
  if (k % 2 === 0) k++
  k = Math.max(5, k)
  const radius = k >> 1
  const sw = small.w
  const sh = small.h
  const tmp = new Int32Array(sw * sh)
  const out = new Int32Array(sw * sh)
  slide(small.data, tmp, sw, sh, radius, true, true)
  slide(tmp, out, sw, sh, radius, false, true)
  slide(out, tmp, sw, sh, radius, true, false)
  slide(tmp, out, sw, sh, radius, false, false)
  const data = median5(out, sw, sh)
  const sorted = Int32Array.from(data).sort()
  const bright = sorted[((sorted.length - 1) * 0.95) | 0]
  return { data: data, w: sw, h: sh, scale: f, bright: bright }
}

function makeUnionFind() {
  let parent = new Int32Array(4096)
  let count = 0
  function find(a) {
    let root = a
    while (parent[root] !== root) root = parent[root]
    let node = a
    while (parent[node] !== root) {
      const next = parent[node]
      parent[node] = root
      node = next
    }
    return root
  }
  return {
    make: function () {
      count++
      if (count >= parent.length) {
        const bigger = new Int32Array(parent.length * 2)
        bigger.set(parent)
        parent = bigger
      }
      parent[count] = count
      return count
    },
    find: find,
    union: function (a, b) {
      const ra = find(a)
      const rb = find(b)
      if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb)
    },
    size: function () {
      return count
    },
  }
}

const DARK_RATIO = 0.4
const BRIGHT_FRACTION = 0.55
const MIN_BLOB_AREA = 30

/** 局部暗度 + 亮度门限 + 8 连通域，得到种子候选点 */
function darkBlobs(gray, background, w, h) {
  const labels = new Int32Array(w * h)
  const uf = makeUnionFind()
  const maxArea = (0.002 * w * h) | 0
  const scale = background.scale
  const gate = BRIGHT_FRACTION * background.bright
  const bw = background.w
  const bh = background.h
  const bg = background.data
  const neighbours = new Int32Array(4)

  // 预先算好横向双线性权重，避免在 700 万像素的内循环里做除法
  const xIdx0 = new Int32Array(w)
  const xIdx1 = new Int32Array(w)
  const xW = new Float32Array(w)
  for (let x = 0; x < w; x++) {
    const sx = (x + 0.5) / scale - 0.5
    let x0 = sx | 0
    if (x0 < 0) x0 = 0
    else if (x0 > bw - 1) x0 = bw - 1
    let wx = sx - x0
    if (wx < 0) wx = 0
    else if (wx > 1) wx = 1
    xIdx0[x] = x0
    xIdx1[x] = Math.min(x0 + 1, bw - 1)
    xW[x] = wx
  }
  const bgRow = new Float32Array(w)

  for (let y = 0; y < h; y++) {
    const sy = (y + 0.5) / scale - 0.5
    let y0 = sy | 0
    if (y0 < 0) y0 = 0
    else if (y0 > bh - 1) y0 = bh - 1
    const y1 = Math.min(y0 + 1, bh - 1)
    let wy = sy - y0
    if (wy < 0) wy = 0
    else if (wy > 1) wy = 1
    const r0 = y0 * bw
    const r1 = y1 * bw
    for (let x = 0; x < w; x++) {
      const i0 = xIdx0[x]
      const i1 = xIdx1[x]
      const wx = xW[x]
      const top = bg[r0 + i0] + (bg[r0 + i1] - bg[r0 + i0]) * wx
      const bottom = bg[r1 + i0] + (bg[r1 + i1] - bg[r1 + i0]) * wx
      const value = top + (bottom - top) * wy
      bgRow[x] = value < 1 ? 1 : value
    }
    const rowOffset = y * w
    for (let x = 0; x < w; x++) {
      const value = bgRow[x]
      if (gray[rowOffset + x] / value >= DARK_RATIO) continue
      if (value < gate) continue

      let found = 0
      neighbours[0] = x > 0 ? labels[rowOffset + x - 1] : 0
      neighbours[1] = y > 0 ? labels[rowOffset - w + x] : 0
      neighbours[2] = x > 0 && y > 0 ? labels[rowOffset - w + x - 1] : 0
      neighbours[3] = x < w - 1 && y > 0 ? labels[rowOffset - w + x + 1] : 0
      for (let i = 0; i < 4; i++) {
        const candidate = neighbours[i]
        if (candidate === 0) continue
        const root = uf.find(candidate)
        if (found === 0) found = root
        else {
          uf.union(found, root)
          found = Math.min(uf.find(found), root)
        }
      }
      labels[rowOffset + x] = found === 0 ? uf.make() : found
    }
  }
  if (uf.size() === 0) return []

  const n = uf.size() + 1
  const area = new Int32Array(n)
  const sumX = new Float64Array(n)
  const sumY = new Float64Array(n)
  const minX = new Int32Array(n).fill(0x7fffffff)
  const minY = new Int32Array(n).fill(0x7fffffff)
  const maxX = new Int32Array(n).fill(-1)
  const maxY = new Int32Array(n).fill(-1)
  for (let y = 0; y < h; y++) {
    const rowOffset = y * w
    for (let x = 0; x < w; x++) {
      const raw = labels[rowOffset + x]
      if (raw === 0) continue
      const root = uf.find(raw)
      area[root]++
      sumX[root] += x
      sumY[root] += y
      if (x < minX[root]) minX[root] = x
      if (x > maxX[root]) maxX[root] = x
      if (y < minY[root]) minY[root] = y
      if (y > maxY[root]) maxY[root] = y
    }
  }
  const blobs = []
  for (let label = 1; label < n; label++) {
    const a = area[label]
    if (a < MIN_BLOB_AREA || a > maxArea) continue
    const bwid = maxX[label] - minX[label] + 1
    const bhei = maxY[label] - minY[label] + 1
    if (Math.max(bwid, bhei) / Math.max(Math.min(bwid, bhei), 1) > 2.0) continue
    if (a / Math.max(bwid * bhei, 1) < 0.55) continue
    blobs.push({ cx: sumX[label] / a, cy: sumY[label] / a, area: a })
  }
  return blobs
}

/** 任意比例区域平均缩小（等价 cv2.INTER_AREA） */
function resizeArea(rgba, w, h, dw, dh) {
  const out = new Uint8ClampedArray(dw * dh * 4)
  const sx = w / dw
  const sy = h / dh
  for (let y = 0; y < dh; y++) {
    const fy0 = y * sy
    const fy1 = (y + 1) * sy
    const iy0 = Math.floor(fy0)
    const iy1 = Math.min(Math.ceil(fy1), h)
    for (let x = 0; x < dw; x++) {
      const fx0 = x * sx
      const fx1 = (x + 1) * sx
      const ix0 = Math.floor(fx0)
      const ix1 = Math.min(Math.ceil(fx1), w)
      let r = 0
      let g = 0
      let b = 0
      let weight = 0
      for (let yy = iy0; yy < iy1; yy++) {
        const wy = Math.min(yy + 1, fy1) - Math.max(yy, fy0)
        if (wy <= 0) continue
        const row = yy * w
        for (let xx = ix0; xx < ix1; xx++) {
          const wx = Math.min(xx + 1, fx1) - Math.max(xx, fx0)
          if (wx <= 0) continue
          const p = (row + xx) * 4
          const wgt = wx * wy
          r += rgba[p] * wgt
          g += rgba[p + 1] * wgt
          b += rgba[p + 2] * wgt
          weight += wgt
        }
      }
      const o = (y * dw + x) * 4
      if (weight <= 0) weight = 1
      out[o] = Math.round(r / weight)
      out[o + 1] = Math.round(g / weight)
      out[o + 2] = Math.round(b / weight)
      out[o + 3] = 255
    }
  }
  return out
}

/** 双线性放大（等价 cv2.INTER_LINEAR） */
function resizeLinear(rgba, w, h, dw, dh) {
  const out = new Uint8ClampedArray(dw * dh * 4)
  const sx = w / dw
  const sy = h / dh
  for (let y = 0; y < dh; y++) {
    let fy = (y + 0.5) * sy - 0.5
    if (fy < 0) fy = 0
    const y0 = Math.min(fy | 0, h - 1)
    const y1 = Math.min(y0 + 1, h - 1)
    const wy = fy - y0
    for (let x = 0; x < dw; x++) {
      let fx = (x + 0.5) * sx - 0.5
      if (fx < 0) fx = 0
      const x0 = Math.min(fx | 0, w - 1)
      const x1 = Math.min(x0 + 1, w - 1)
      const wx = fx - x0
      const p00 = (y0 * w + x0) * 4
      const p01 = (y0 * w + x1) * 4
      const p10 = (y1 * w + x0) * 4
      const p11 = (y1 * w + x1) * 4
      const o = (y * dw + x) * 4
      for (let c = 0; c < 3; c++) {
        const top = rgba[p00 + c] + (rgba[p01 + c] - rgba[p00 + c]) * wx
        const bottom = rgba[p10 + c] + (rgba[p11 + c] - rgba[p10 + c]) * wx
        out[o + c] = Math.round(top + (bottom - top) * wy)
      }
      out[o + 3] = 255
    }
  }
  return out
}

/** 裁剪方形区域 */
function cropRect(rgba, w, h, x, y, side) {
  const out = new Uint8ClampedArray(side * side * 4)
  for (let row = 0; row < side; row++) {
    const src = ((y + row) * w + x) * 4
    out.set(rgba.subarray(src, src + side * 4), row * side * 4)
  }
  return out
}

export default {
  toGray: toGray,
  localBackground: localBackground,
  darkBlobs: darkBlobs,
  resizeArea: resizeArea,
  resizeLinear: resizeLinear,
  cropRect: cropRect,
}
