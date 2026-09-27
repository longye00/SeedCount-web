/**
 * StarDist 分块推理 + 射线轮廓还原 + 多边形 NMS。
 * 参数与 Android v0.5 完全一致，模型换成同一权重导出的 ONNX。
 */
import locator from './locator.js'
import roiUtil from './roi.js'
import poly from './poly.js'

/** 让出 JS 线程，保证进度条能刷新 */
function nextTick() {
  return new Promise(function (resolve) {
    setTimeout(resolve, 0)
  })
}

const TILE_SIZE = 768
const TILE_STEP = 632
const N_RAYS = 32
const GRID = 2
const PROBABILITY_THRESHOLD = 0.6443783
const NMS_IOU_THRESHOLD = 0.3
const MAX_CANDIDATES = 5000
const NMS_CELL = 64

const COS = new Float64Array(N_RAYS)
const SIN = new Float64Array(N_RAYS)
for (let i = 0; i < N_RAYS; i++) {
  const angle = (2 * Math.PI * i) / N_RAYS
  COS[i] = Math.cos(angle)
  SIN[i] = Math.sin(angle)
}

/** 分块起点：相邻切片重叠至少 TILE_SIZE - TILE_STEP 像素 */
function tileStarts(size) {
  if (size <= TILE_SIZE) return [0]
  const span = size - TILE_SIZE
  const n = Math.ceil(span / TILE_STEP) + 1
  const starts = []
  for (let i = 0; i < n; i++) starts.push(Math.round((i * span) / (n - 1)))
  return starts
}

/** 全图 RGB 的 1% 与 99.8% 分位，用于对比度归一化 */
function percentileRange(rgba, pixelCount) {
  const histogram = new Float64Array(256)
  for (let i = 0, p = 0; i < pixelCount; i++, p += 4) {
    histogram[rgba[p]]++
    histogram[rgba[p + 1]]++
    histogram[rgba[p + 2]]++
  }
  const total = pixelCount * 3
  function at(fraction) {
    const target = total * fraction
    let cumulative = 0
    for (let value = 0; value < 256; value++) {
      cumulative += histogram[value]
      if (cumulative >= target) return value
    }
    return 255
  }
  const low = at(0.01)
  const high = Math.max(low + 1, at(0.998))
  return { low: low, high: high }
}

function fillInput(target, rgba, size, startX, startY, low, high) {
  const denominator = high - low
  let out = 0
  for (let y = 0; y < TILE_SIZE; y++) {
    let index = ((startY + y) * size + startX) * 4
    for (let x = 0; x < TILE_SIZE; x++) {
      for (let c = 0; c < 3; c++) {
        let v = (rgba[index + c] - low) / denominator
        if (v < 0) v = 0
        else if (v > 1) v = 1
        target[out++] = v
      }
      index += 4
    }
  }
  return target
}

function isLocalMaximum(prob, outWidth, x, y, value) {
  const centerIndex = y * outWidth + x
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue
      const otherIndex = (y + dy) * outWidth + (x + dx)
      const other = prob[otherIndex]
      if (other > value || (other === value && otherIndex < centerIndex)) return false
    }
  }
  return true
}

function extractCandidates(prob, dist, outWidth, outHeight, tileX, tileY, size, margin, single) {
  const found = []
  for (let y = 1; y < outHeight - 1; y++) {
    for (let x = 1; x < outWidth - 1; x++) {
      const index = y * outWidth + x
      const score = prob[index]
      if (score < PROBABILITY_THRESHOLD) continue
      if (!isLocalMaximum(prob, outWidth, x, y, score)) continue
      const localX = x * GRID
      const localY = y * GRID
      if (!single) {
        if (tileX > 0 && localX < margin) continue
        if (tileY > 0 && localY < margin) continue
        if (tileX + TILE_SIZE < size && localX > TILE_SIZE - margin) continue
        if (tileY + TILE_SIZE < size && localY > TILE_SIZE - margin) continue
      }
      const base = index * N_RAYS
      let valid = true
      let maxRay = 0
      for (let ray = 0; ray < N_RAYS; ray++) {
        const value = dist[base + ray]
        if (!isFinite(value) || value <= 0 || value > 180) {
          valid = false
          break
        }
        if (value > maxRay) maxRay = value
      }
      if (!valid) continue
      const centerX = tileX + localX
      const centerY = tileY + localY
      const xs = new Float64Array(N_RAYS)
      const ys = new Float64Array(N_RAYS)
      for (let ray = 0; ray < N_RAYS; ray++) {
        const value = dist[base + ray]
        let px = centerX + value * COS[ray]
        let py = centerY + value * SIN[ray]
        if (px < 0) px = 0
        else if (px > size - 1) px = size - 1
        if (py < 0) py = 0
        else if (py > size - 1) py = size - 1
        xs[ray] = px
        ys[ray] = py
      }
      const shape = poly.rasterize(xs, ys)
      if (shape.area < 9 || shape.w < 2 || shape.h < 2) continue
      found.push({
        score: score,
        centerX: centerX,
        centerY: centerY,
        radius: maxRay,
        xs: xs,
        ys: ys,
        shape: shape,
        area: shape.area,
      })
    }
  }
  return found
}

/** 多边形 IoU NMS，带 64px 网格加速 */
function polygonNms(candidates) {
  const ordered = candidates
    .slice()
    .sort(function (a, b) {
      return b.score - a.score
    })
    .slice(0, MAX_CANDIDATES)
  const accepted = []
  const grid = {}
  for (let i = 0; i < ordered.length; i++) {
    const candidate = ordered[i]
    const gx = Math.floor(candidate.centerX / NMS_CELL)
    const gy = Math.floor(candidate.centerY / NMS_CELL)
    const span = Math.floor(candidate.radius / NMS_CELL) + 2
    let keep = true
    for (let ax = gx - span; ax <= gx + span && keep; ax++) {
      for (let ay = gy - span; ay <= gy + span && keep; ay++) {
        const bucket = grid[ax + ':' + ay]
        if (!bucket) continue
        for (let k = 0; k < bucket.length; k++) {
          const other = bucket[k]
          const dx = candidate.centerX - other.centerX
          const dy = candidate.centerY - other.centerY
          const reach = candidate.radius + other.radius
          if (dx * dx + dy * dy > reach * reach) continue
          if (poly.iou(candidate.shape, other.shape) > NMS_IOU_THRESHOLD) {
            keep = false
            break
          }
        }
      }
    }
    if (!keep) continue
    const key = gx + ':' + gy
    if (!grid[key]) grid[key] = []
    grid[key].push(candidate)
    accepted.push(candidate)
  }
  return accepted.sort(function (a, b) {
    return a.centerY - b.centerY || a.centerX - b.centerX
  })
}

/**
 * 完整计数流程。
 * @param {object} options
 * @param {Uint8ClampedArray} options.rgba 原图像素
 * @param {number} options.width
 * @param {number} options.height
 * @param {object|null} options.roi 手动框选区域
 * @param {function} options.runTile async (Float32Array) => { prob, dist, outWidth, outHeight }
 * @param {function} [options.onProgress] (percent, message) => void
 */
async function analyze(options) {
  const started = Date.now()
  const rgba = options.rgba
  const width = options.width
  const height = options.height
  const roi = options.roi || null
  const report = options.onProgress || function () {}

  report(4, roi ? '正在准备框选区域' : '正在定位种子区域')
  await nextTick()
  const region = locator.locate(rgba, width, height, roi)
  const crop = locator.buildCrop(rgba, width, height, region)
  const size = crop.size
  const range = percentileRange(crop.data, size * size)

  const starts = tileStarts(size)
  const single = starts.length === 1
  const step = single ? 0 : starts[1] - starts[0]
  const margin = single ? 0 : (TILE_SIZE - step) / 2
  const total = starts.length * starts.length
  const input = new Float32Array(TILE_SIZE * TILE_SIZE * 3)
  let candidates = []
  let tileNumber = 0

  for (let iy = 0; iy < starts.length; iy++) {
    for (let ix = 0; ix < starts.length; ix++) {
      tileNumber++
      report(8 + ((tileNumber - 1) * 70) / total, '正在分析第 ' + tileNumber + '/' + total + ' 个区域')
      await nextTick()
      fillInput(input, crop.data, size, starts[ix], starts[iy], range.low, range.high)
      const out = await options.runTile(input)
      candidates = candidates.concat(
        extractCandidates(
          out.prob,
          out.dist,
          out.outWidth,
          out.outHeight,
          starts[ix],
          starts[iy],
          size,
          margin,
          single
        )
      )
    }
  }

  report(82, '正在合并重复实例')
  await nextTick()
  let scoped = candidates
  if (roi && roiUtil.isUsable(roi)) {
    const ratio = region.side / size
    scoped = candidates.filter(function (candidate) {
      return roiUtil.contains(roi, region.x + candidate.centerX * ratio, region.y + candidate.centerY * ratio)
    })
  }
  const accepted = polygonNms(scoped)

  const seeds = accepted.map(function (candidate, index) {
    return {
      id: index + 1,
      centerX: candidate.centerX,
      centerY: candidate.centerY,
      areaPx: candidate.area,
      equivalentDiameterPx: 2 * Math.sqrt(candidate.area / Math.PI),
      score: candidate.score,
      xs: candidate.xs,
      ys: candidate.ys,
    }
  })
  const median = locator.median(
    seeds.map(function (seed) {
      return seed.equivalentDiameterPx
    })
  )
  report(100, '计数完成')
  return {
    count: seeds.length,
    seeds: seeds,
    crop: crop.data,
    cropSize: size,
    region: region,
    medianDiameterPx: seeds.length ? median : null,
    processingMs: Date.now() - started,
  }
}

export default {
  TILE_SIZE: TILE_SIZE,
  N_RAYS: N_RAYS,
  PROBABILITY_THRESHOLD: PROBABILITY_THRESHOLD,
  NMS_IOU_THRESHOLD: NMS_IOU_THRESHOLD,
  tileStarts: tileStarts,
  percentileRange: percentileRange,
  analyze: analyze,
}
