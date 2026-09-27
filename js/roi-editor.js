/**
 * 多区域编辑器。
 * 每个区域仍沿用原有坐标结构；多个区域包装为：
 * { tool: 'multi', regions: [{ tool, points }, ...] }
 */
import roiUtil from './core/roi.js'

const HINTS = {
  rect: '拖动绘制',
  circle: '从中心向外拖动',
  polygon: '点击添加顶点',
  freehand: '按住绘制',
}

function cloneRegion(region) {
  return {
    tool: region.tool,
    points: (region.points || []).map((point) => ({ x: point.x, y: point.y })),
  }
}

class RoiEditor {
  constructor(elements) {
    this.el = elements
    this.regions = []
    this.points = []
    this.tool = 'rect'
    this.dragging = false
    this.onConfirm = null
    this.bindEvents()
  }

  bindEvents() {
    this.el.tools.addEventListener('click', (event) => {
      const id = event.target.dataset && event.target.dataset.id
      if (!id || id === this.tool) return
      if (this.draftUsable()) this.commitDraft()
      else this.points = []
      this.tool = id
      this.setActiveTool()
      this.setHint(HINTS[id])
      this.sync()
      this.redraw()
    })

    const canvas = this.el.canvas
    canvas.addEventListener('pointerdown', (event) => this.onPointerDown(event))
    canvas.addEventListener('pointermove', (event) => this.onPointerMove(event))
    canvas.addEventListener('pointerup', (event) => this.onPointerUp(event))
    canvas.addEventListener('pointercancel', () => {
      this.dragging = false
      this.sync()
    })

    this.el.undo.addEventListener('click', () => {
      if (this.points.length) {
        if (this.tool === 'polygon') this.points.pop()
        else this.points = []
      } else {
        this.regions.pop()
      }
      this.setHint(HINTS[this.tool])
      this.sync()
      this.redraw()
    })

    this.el.reset.addEventListener('click', () => {
      this.points = []
      this.regions = []
      this.setHint(HINTS[this.tool])
      this.sync()
      this.redraw()
    })

    this.el.cancel.addEventListener('click', () => this.close(null))
    this.el.add.addEventListener('click', () => {
      if (!this.commitDraft()) {
        this.setHint('请先画出一个区域')
        return
      }
      this.setHint('可继续绘制')
      this.redraw()
    })
    this.el.ok.addEventListener('click', () => this.finish())
  }

  /** @param {HTMLCanvasElement} photoCanvas 解码后的原图画布 */
  open(photoCanvas, existingRoi, onConfirm) {
    this.photo = photoCanvas
    this.onConfirm = onConfirm
    this.regions = roiUtil.regions(existingRoi).map(cloneRegion)
    this.points = []
    if (this.regions.length) this.tool = this.regions[this.regions.length - 1].tool
    this.setActiveTool()
    this.setHint(HINTS[this.tool])
    this.el.modal.hidden = false
    this.layout()
    if (!this.layoutBound) this.layoutBound = () => this.layout()
    window.addEventListener('resize', this.layoutBound)
    this.sync()
    this.redraw()
  }

  close(roi) {
    this.el.modal.hidden = true
    window.removeEventListener('resize', this.layoutBound)
    const callback = this.onConfirm
    this.onConfirm = null
    if (callback) callback(roi)
  }

  finish() {
    if (this.draftUsable()) this.commitDraft()
    else if (this.points.length) this.points = []
    if (!this.regions.length) {
      this.setHint('请先画出一个区域')
      this.sync()
      this.redraw()
      return
    }
    this.close({
      tool: 'multi',
      regions: this.regions.map(cloneRegion),
    })
  }

  draftRegion() {
    return { tool: this.tool, points: this.points }
  }

  draftUsable() {
    return roiUtil.isUsable(this.draftRegion())
  }

  commitDraft() {
    if (!this.draftUsable()) return false
    this.regions.push(cloneRegion(this.draftRegion()))
    this.points = []
    this.sync()
    return true
  }

  setActiveTool() {
    for (const node of this.el.tools.children) {
      node.classList.toggle('is-active', node.dataset.id === this.tool)
    }
  }

  setHint(text) {
    this.el.hint.textContent = text
  }

  sync() {
    const hasDraft = this.draftUsable()
    this.el.counter.textContent = this.regions.length + ' 个区域'
    this.el.add.disabled = !hasDraft
    this.el.undo.disabled = !this.points.length && !this.regions.length
    this.el.reset.disabled = !this.points.length && !this.regions.length
    this.el.ok.disabled = !hasDraft && !this.regions.length
  }

  layout() {
    if (!this.photo || this.el.modal.hidden) return
    const canvas = this.el.canvas
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = Math.max(1, Math.round(rect.width * dpr))
    canvas.height = Math.max(1, Math.round(rect.height * dpr))
    this.viewW = rect.width
    this.viewH = rect.height
    this.dpr = dpr
    const sourceW = this.photo.width
    const sourceH = this.photo.height
    this.scale = Math.min(this.viewW / sourceW, this.viewH / sourceH)
    this.offsetX = (this.viewW - sourceW * this.scale) / 2
    this.offsetY = (this.viewH - sourceH * this.scale) / 2
    this.redraw()
  }

  toSource(x, y) {
    return {
      x: Math.min(Math.max((x - this.offsetX) / this.scale, 0), this.photo.width - 1),
      y: Math.min(Math.max((y - this.offsetY) / this.scale, 0), this.photo.height - 1),
    }
  }

  toView(point) {
    return {
      x: point.x * this.scale + this.offsetX,
      y: point.y * this.scale + this.offsetY,
    }
  }

  eventPoint(event) {
    const rect = this.el.canvas.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  redraw() {
    if (!this.photo || !this.viewW || !this.viewH) return
    const canvas = this.el.canvas
    const ctx = canvas.getContext('2d')
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.clearRect(0, 0, this.viewW, this.viewH)
    ctx.fillStyle = '#171819'
    ctx.fillRect(0, 0, this.viewW, this.viewH)
    ctx.drawImage(
      this.photo,
      this.offsetX,
      this.offsetY,
      this.photo.width * this.scale,
      this.photo.height * this.scale
    )

    for (let index = 0; index < this.regions.length; index++) {
      this.drawRegion(ctx, this.regions[index], false, index + 1)
    }
    if (this.points.length) this.drawRegion(ctx, this.draftRegion(), true)
  }

  drawRegion(ctx, region, active, label) {
    const points = region.points || []
    if (!points.length) return
    ctx.save()
    ctx.strokeStyle = active ? '#5e9fe8' : '#9ac7f2'
    ctx.fillStyle = active ? 'rgba(39,131,222,.18)' : 'rgba(39,131,222,.13)'
    ctx.lineWidth = active ? 2.4 : 2
    ctx.setLineDash(active ? [8, 6] : [])
    ctx.beginPath()

    if (region.tool === 'rect' && points.length >= 2) {
      const a = this.toView(points[0])
      const b = this.toView(points[1])
      ctx.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y))
    } else if (region.tool === 'circle' && points.length >= 2) {
      const center = this.toView(points[0])
      const edge = this.toView(points[1])
      ctx.arc(center.x, center.y, Math.hypot(edge.x - center.x, edge.y - center.y), 0, 2 * Math.PI)
    } else if (points.length >= 2) {
      const first = this.toView(points[0])
      ctx.moveTo(first.x, first.y)
      for (let index = 1; index < points.length; index++) {
        const point = this.toView(points[index])
        ctx.lineTo(point.x, point.y)
      }
      if (points.length >= 3) ctx.closePath()
    }

    if (points.length >= 2) {
      ctx.fill()
      ctx.stroke()
    }
    ctx.restore()

    if (active && region.tool === 'polygon') this.drawVertices(ctx)
    if (!active && label) this.drawLabel(ctx, region, label)
  }

  drawVertices(ctx) {
    ctx.fillStyle = '#5e9fe8'
    for (const point of this.points) {
      const view = this.toView(point)
      ctx.beginPath()
      ctx.arc(view.x, view.y, 4.5, 0, 2 * Math.PI)
      ctx.fill()
    }
  }

  drawLabel(ctx, region, label) {
    const bound = roiUtil.bounds(region)
    const anchor = this.toView({ x: bound.left, y: bound.top })
    const x = Math.max(17, Math.min(this.viewW - 17, anchor.x + 13))
    const y = Math.max(17, Math.min(this.viewH - 17, anchor.y + 13))
    ctx.save()
    ctx.fillStyle = '#2783de'
    ctx.beginPath()
    ctx.arc(x, y, 11, 0, 2 * Math.PI)
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.font = '600 11px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(label), x, y + .5)
    ctx.restore()
  }

  onPointerDown(event) {
    if (!this.photo) return
    event.preventDefault()
    this.el.canvas.setPointerCapture(event.pointerId)
    const view = this.eventPoint(event)
    const point = this.toSource(view.x, view.y)

    if (this.tool === 'rect' || this.tool === 'circle' || this.tool === 'freehand') {
      if (this.draftUsable()) this.commitDraft()
    }

    if (this.tool === 'rect' || this.tool === 'circle') {
      this.points = [point, point]
      this.dragging = true
    } else if (this.tool === 'freehand') {
      this.points = [point]
      this.dragging = true
    } else {
      this.tapStart = view
      this.dragging = false
    }
    this.sync()
    this.redraw()
  }

  onPointerMove(event) {
    if (!this.photo || !this.dragging) return
    event.preventDefault()
    const view = this.eventPoint(event)
    const point = this.toSource(view.x, view.y)
    if (this.tool === 'rect' || this.tool === 'circle') {
      this.points[1] = point
      this.sync()
      this.redraw()
    } else if (this.tool === 'freehand') {
      const last = this.points[this.points.length - 1]
      const minStep = 6 / this.scale
      if (!last || Math.hypot(point.x - last.x, point.y - last.y) >= minStep) {
        this.points.push(point)
        this.sync()
        this.redraw()
      }
    }
  }

  onPointerUp(event) {
    if (!this.photo) return
    if (this.tool === 'polygon' && this.tapStart) {
      const view = this.eventPoint(event)
      if (Math.hypot(view.x - this.tapStart.x, view.y - this.tapStart.y) < 12) {
        this.points.push(this.toSource(view.x, view.y))
      }
    }
    this.tapStart = null
    this.dragging = false
    this.sync()
    this.redraw()
  }
}

export default RoiEditor