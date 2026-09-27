/**
 * 在整张照片里定位「种子所在的方形区域」，并决定送入模型的分析尺寸。
 * 模型是在裁出培养皿后的图上训练的，种子直径约 16~27 px；
 * 直接把整张照片缩到固定大小会让种子远小于训练尺度，导致大量漏检。
 * 这里先用局部暗度找候选点，再用稳健统计估计种子群圆心与半径。
 */
import imaging from './imaging.js'
import roiUtil from './roi.js'

const MIN_ANALYSIS = 768
const MAX_ANALYSIS = 1400
const DIAMETER_FLOOR = 17
const DIAMETER_TARGET = 20
const DIAMETER_CEILING = 30
const DIAMETER_TARGET_HIGH = 26
const GROW = 1.1

function clampAnalysis(value) {
  return Math.min(Math.max(Math.round(value), MIN_ANALYSIS), MAX_ANALYSIS)
}

function median(values) {
  if (values.length === 0) return 0
  const v = Float64Array.from(values).sort()
  const mid = v.length >> 1
  return v.length % 2 === 1 ? v[mid] : (v[mid - 1] + v[mid]) / 2
}

function percentile(values, fraction) {
  if (values.length === 0) return 0
  const v = Float64Array.from(values).sort()
  const position = fraction * (v.length - 1)
  const lower = Math.floor(position)
  const upper = Math.min(lower + 1, v.length - 1)
  const weight = position - lower
  return v[lower] * (1 - weight) + v[upper] * weight
}

function analysisFor(side, diameter) {
  let analysis = clampAnalysis(side)
  if (diameter > 1) {
    const effective = (diameter * analysis) / side
    if (effective < DIAMETER_FLOOR) analysis = clampAnalysis((side * DIAMETER_TARGET) / diameter)
    else if (effective > DIAMETER_CEILING) analysis = clampAnalysis((side * DIAMETER_TARGET_HIGH) / diameter)
  }
  return analysis
}

/**
 * @param {Uint8ClampedArray} rgba 原图像素
 * @param {number} w 原图宽
 * @param {number} h 原图高
 * @param {object|null} roi 手动框选区域
 */
function locate(rgba, w, h, roi) {
  const gray = imaging.toGray(rgba, w, h)
  const background = imaging.localBackground(gray, w, h)
  const blobs = imaging.darkBlobs(gray, background, w, h)

  if (roi && roiUtil.isUsable(roi)) return fromRoi(roi, blobs, w, h)

  if (blobs.length < 5) {
    const side = Math.min(w, h)
    return {
      x: (w - side) >> 1,
      y: (h - side) >> 1,
      side: side,
      analysisSize: clampAnalysis(side),
      blobCount: blobs.length,
      medianDiameterPx: 0,
    }
  }

  const n = blobs.length
  const xs = new Float64Array(n)
  const ys = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    xs[i] = blobs[i].cx
    ys[i] = blobs[i].cy
  }
  let cx = median(xs)
  let cy = median(ys)
  const distances = new Float64Array(n)

  for (let round = 0; round < 4; round++) {
    let r = robustRadius(xs, ys, cx, cy, distances)
    if (r <= 0) r = 1
    const limit = 1.3 * r
    let sumX = 0
    let sumY = 0
    let kept = 0
    for (let i = 0; i < n; i++) {
      if (distances[i] <= limit) {
        sumX += xs[i]
        sumY += ys[i]
        kept++
      }
    }
    if (kept < 3) break
    cx = sumX / kept
    cy = sumY / kept
  }

  let r = robustRadius(xs, ys, cx, cy, distances)
  if (r <= 0) r = 1
  const limit = 1.3 * r
  const inlierDistances = []
  const inlierAreas = []
  for (let i = 0; i < n; i++) {
    if (distances[i] <= limit) {
      inlierDistances.push(distances[i])
      inlierAreas.push(blobs[i].area)
    }
  }
  if (inlierDistances.length === 0) {
    inlierDistances.push(r)
    inlierAreas.push(0)
  }

  const outer = Math.max(r, percentile(inlierDistances, 0.97)) * GROW
  const side = Math.min(Math.max(Math.round(2 * outer), 320), Math.min(w, h))
  const x0 = Math.min(Math.max(Math.round(cx - side / 2), 0), w - side)
  const y0 = Math.min(Math.max(Math.round(cy - side / 2), 0), h - side)

  const diameters = inlierAreas.map(function (a) {
    return 2 * Math.sqrt(a / Math.PI)
  })
  const diameter = median(diameters)

  return {
    x: x0,
    y: y0,
    side: side,
    analysisSize: analysisFor(side, diameter),
    blobCount: inlierDistances.length,
    medianDiameterPx: diameter,
  }
}

/** 手动框选时，以选区外接方形为分析区域，只用选区内暗点估计粒径 */
function fromRoi(roi, blobs, w, h) {
  const b = roiUtil.bounds(roi)
  const side = Math.min(
    Math.max(Math.round(Math.max(b.right - b.left, b.bottom - b.top) * 1.04), 32),
    Math.min(w, h)
  )
  const cx = (b.left + b.right) / 2
  const cy = (b.top + b.bottom) / 2
  const x0 = Math.min(Math.max(Math.round(cx - side / 2), 0), w - side)
  const y0 = Math.min(Math.max(Math.round(cy - side / 2), 0), h - side)
  const inside = blobs.filter(function (blob) {
    return roiUtil.contains(roi, blob.cx, blob.cy)
  })
  const diameter = inside.length
    ? median(
        inside.map(function (blob) {
          return 2 * Math.sqrt(blob.area / Math.PI)
        })
      )
    : 0
  return {
    x: x0,
    y: y0,
    side: side,
    analysisSize: analysisFor(side, diameter),
    blobCount: inside.length,
    medianDiameterPx: diameter,
  }
}

function robustRadius(xs, ys, cx, cy, out) {
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - cx
    const dy = ys[i] - cy
    out[i] = Math.sqrt(dx * dx + dy * dy)
  }
  // 均匀圆盘上，到圆心距离的中位数 ≈ R/√2
  return 1.4142 * median(out)
}

/** 按 region 裁剪并缩放到分析尺寸 */
function buildCrop(rgba, w, h, region) {
  const cropped = imaging.cropRect(rgba, w, h, region.x, region.y, region.side)
  const target = region.analysisSize
  if (target === region.side) return { data: cropped, size: region.side }
  const data =
    target < region.side
      ? imaging.resizeArea(cropped, region.side, region.side, target, target)
      : imaging.resizeLinear(cropped, region.side, region.side, target, target)
  return { data: data, size: target }
}

export default {
  MIN_ANALYSIS: MIN_ANALYSIS,
  MAX_ANALYSIS: MAX_ANALYSIS,
  locate: locate,
  buildCrop: buildCrop,
  median: median,
}
