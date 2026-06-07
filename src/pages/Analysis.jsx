import { useEffect, useRef, useState, useCallback } from 'react'
import {
  createChart, CandlestickSeries, LineSeries, HistogramSeries,
} from 'lightweight-charts'

// ── Binance API ──────────────────────────────────────────────────────────────

const SYMBOLS = {
  'BTC':  'BTCUSDT',
  'ETH':  'ETHUSDT',
  'BNB':  'BNBUSDT',
  'SOL':  'SOLUSDT',
  'XRP':  'XRPUSDT',
  'DOGE': 'DOGEUSDT',
  'ADA':  'ADAUSDT',
  'AVAX': 'AVAXUSDT',
  'LINK': 'LINKUSDT',
  'DOT':  'DOTUSDT',
}

const INTERVALS = {
  '15m': { label: '15M', binance: '15m', limit: 200 },
  '1h':  { label: '1H',  binance: '1h',  limit: 200 },
  '4h':  { label: '4H',  binance: '4h',  limit: 200 },
  '1d':  { label: '1D',  binance: '1d',  limit: 200 },
  '1w':  { label: '1S',  binance: '1w',  limit: 100 },
}

async function fetchCandles(pair, interval) {
  const symbol = SYMBOLS[pair]
  const { binance, limit } = INTERVALS[interval]
  const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${binance}&limit=${limit}`)
  const raw = await res.json()
  return raw.map(c => ({
    time:   Math.floor(c[0] / 1000),
    open:   parseFloat(c[1]),
    high:   parseFloat(c[2]),
    low:    parseFloat(c[3]),
    close:  parseFloat(c[4]),
    volume: parseFloat(c[5]),
  }))
}

// ── Yahoo Finance API (Acciones) ─────────────────────────────────────────────

const YF_INTERVALS = {
  '15m': { yf: '15m',  range: '5d'   },
  '1h':  { yf: '60m',  range: '30d'  },
  '4h':  { yf: '1d',   range: '6mo'  },
  '1d':  { yf: '1d',   range: '1y'   },
  '1w':  { yf: '1wk',  range: '5y'   },
}

async function fetchCandlesStock(symbol, interval) {
  const { yf, range } = YF_INTERVALS[interval]
  const res = await fetch(`/api/stock?symbol=${symbol.toUpperCase()}&interval=${yf}&range=${range}`)
  const data = await res.json()
  const result = data.chart?.result?.[0]
  if (!result) throw new Error('Sin datos para ' + symbol)
  const { timestamp, indicators: { quote: [q] } } = result
  return timestamp
    .map((t, i) => ({
      time:   t,
      open:   q.open[i],
      high:   q.high[i],
      low:    q.low[i],
      close:  q.close[i],
      volume: q.volume[i] ?? 0,
    }))
    .filter(c => c.open != null && c.close != null)
}

// ── Indicadores ──────────────────────────────────────────────────────────────

function calcEMA(closes, period) {
  const k = 2 / (period + 1)
  const result = new Array(closes.length).fill(null)
  let sum = 0
  for (let i = 0; i < period; i++) sum += closes[i]
  result[period - 1] = sum / period
  for (let i = period; i < closes.length; i++)
    result[i] = closes[i] * k + result[i - 1] * (1 - k)
  return result
}

function calcADX(candles, period = 14) {
  const n = candles.length
  const tr = new Array(n).fill(0), pdm = new Array(n).fill(0), mdm = new Array(n).fill(0)
  for (let i = 1; i < n; i++) {
    const { high, low } = candles[i], pc = candles[i-1].close, ph = candles[i-1].high, pl = candles[i-1].low
    tr[i]  = Math.max(high - low, Math.abs(high - pc), Math.abs(low - pc))
    pdm[i] = high - ph > pl - low && high - ph > 0 ? high - ph : 0
    mdm[i] = pl - low > high - ph && pl - low > 0 ? pl - low : 0
  }
  function wilder(arr, p) {
    const out = new Array(n).fill(null)
    let s = 0; for (let i = 1; i <= p; i++) s += arr[i]; out[p] = s
    for (let i = p + 1; i < n; i++) out[i] = out[i-1] - out[i-1]/p + arr[i]
    return out
  }
  const sTR = wilder(tr, period), sPDM = wilder(pdm, period), sMDM = wilder(mdm, period)
  const dx = new Array(n).fill(null)
  for (let i = period; i < n; i++) {
    if (!sTR[i]) continue
    const diP = (sPDM[i] / sTR[i]) * 100, diM = (sMDM[i] / sTR[i]) * 100
    const s = diP + diM
    dx[i] = s === 0 ? 0 : (Math.abs(diP - diM) / s) * 100
  }
  const adx = new Array(n).fill(null)
  let first = dx.findIndex(v => v !== null); if (first < 0) return adx
  let sum = 0; for (let i = first; i < first + period && i < n; i++) sum += dx[i]
  adx[first + period - 1] = sum / period
  for (let i = first + period; i < n; i++) adx[i] = (adx[i-1] * (period-1) + dx[i]) / period
  return adx
}

function calcSMA(arr, p) {
  const out = new Array(arr.length).fill(null)
  for (let i = p - 1; i < arr.length; i++)
    out[i] = arr.slice(i - p + 1, i + 1).reduce((a, b) => a + b) / p
  return out
}

function calcATR(candles, p) {
  const n = candles.length, tr = new Array(n).fill(null)
  for (let i = 1; i < n; i++) {
    const { high, low } = candles[i], pc = candles[i-1].close
    tr[i] = Math.max(high - low, Math.abs(high - pc), Math.abs(low - pc))
  }
  const atr = new Array(n).fill(null)
  let s = 0; for (let i = 1; i <= p; i++) s += tr[i] ?? 0; atr[p] = s / p
  for (let i = p + 1; i < n; i++) atr[i] = (atr[i-1] * (p-1) + (tr[i] ?? 0)) / p
  return atr
}

function linReg(xs, ys, atX) {
  const n = xs.length, sx = xs.reduce((a, b) => a + b, 0), sy = ys.reduce((a, b) => a + b, 0)
  const sxy = xs.reduce((s, x, i) => s + x * ys[i], 0), sx2 = xs.reduce((s, x) => s + x * x, 0)
  const d = n * sx2 - sx * sx; if (d === 0) return sy / n
  const m = (n * sxy - sx * sy) / d, b = (sy - m * sx) / n; return m * atX + b
}

function calcSqueeze(candles, bbLen = 20, bbMult = 2.0, kcLen = 20, kcMult = 1.5) {
  const n = candles.length, closes = candles.map(c => c.close)
  const highs = candles.map(c => c.high), lows = candles.map(c => c.low)

  // Bollinger Bands
  const bbBasis = calcSMA(closes, bbLen)
  const bbU = new Array(n).fill(null), bbL = new Array(n).fill(null)
  for (let i = bbLen - 1; i < n; i++) {
    const sl = closes.slice(i - bbLen + 1, i + 1), m = bbBasis[i]
    const std = Math.sqrt(sl.reduce((s, v) => s + (v - m) ** 2, 0) / bbLen)
    bbU[i] = m + bbMult * std; bbL[i] = m - bbMult * std
  }

  // Keltner Channel
  const atr = calcATR(candles, kcLen), kcBasis = calcSMA(closes, kcLen)
  const kcU = new Array(n).fill(null), kcL = new Array(n).fill(null)
  for (let i = 0; i < n; i++) {
    if (!atr[i] || !kcBasis[i]) continue
    kcU[i] = kcBasis[i] + kcMult * atr[i]; kcL[i] = kcBasis[i] - kcMult * atr[i]
  }

  const sqzOn = new Array(n).fill(false), sqzOff = new Array(n).fill(false)
  for (let i = 0; i < n; i++) {
    if (!bbU[i] || !kcU[i]) continue
    sqzOn[i]  = bbU[i] < kcU[i] && bbL[i] > kcL[i]
    sqzOff[i] = bbU[i] >= kcU[i] && bbL[i] <= kcL[i]
  }

  // LazyBear: delta[i] = close[i] - avg(avg(highest_high, lowest_low), sma_close)
  const delta = new Array(n).fill(null)
  for (let i = kcLen - 1; i < n; i++) {
    const hh  = Math.max(...highs.slice(i - kcLen + 1, i + 1))
    const ll  = Math.min(...lows.slice(i - kcLen + 1, i + 1))
    delta[i]  = closes[i] - ((hh + ll) / 2 + kcBasis[i]) / 2
  }

  // momentum = linreg(delta, kcLen, 0) — oscila alrededor de 0
  const xs = Array.from({ length: kcLen }, (_, j) => j)
  const momentum = new Array(n).fill(null)
  for (let i = kcLen * 2 - 2; i < n; i++) {
    const window = delta.slice(i - kcLen + 1, i + 1)
    if (window.some(v => v === null)) continue
    momentum[i] = linReg(xs, window, kcLen - 1)
  }

  return { momentum, sqzOn, sqzOff }
}

// ── Volume Profile ───────────────────────────────────────────────────────────

function calcVolumeProfile(candles, numBuckets = 120) {
  const maxP = Math.max(...candles.map(c => c.high))
  const minP = Math.min(...candles.map(c => c.low))
  const bucketSize = (maxP - minP) / numBuckets
  const buckets = new Array(numBuckets).fill(0)
  for (const c of candles) {
    const range = c.high - c.low || 0.0001
    const volPerPrice = c.volume / range
    const lo = Math.max(0, Math.floor((c.low  - minP) / bucketSize))
    const hi = Math.min(numBuckets - 1, Math.floor((c.high - minP) / bucketSize))
    for (let b = lo; b <= hi; b++) buckets[b] += volPerPrice * bucketSize
  }
  const maxVol = Math.max(...buckets)
  const pocIdx = buckets.indexOf(maxVol)
  const pocPrice = minP + (pocIdx + 0.5) * bucketSize
  const totalVol = buckets.reduce((a, b) => a + b, 0)
  let lo = pocIdx, hi = pocIdx, acc = buckets[pocIdx]
  while (acc < totalVol * 0.7) {
    const expL = lo > 0 ? buckets[lo - 1] : 0
    const expH = hi < numBuckets - 1 ? buckets[hi + 1] : 0
    if (expL >= expH && lo > 0) { lo--; acc += buckets[lo] }
    else if (hi < numBuckets - 1) { hi++; acc += buckets[hi] }
    else break
  }
  return { buckets, bucketSize, minPrice: minP, maxVol, pocPrice,
    vahPrice: minP + (hi + 1) * bucketSize,
    valPrice: minP + lo * bucketSize }
}

// ── Soporte / Resistencia ────────────────────────────────────────────────────

function calcSR(candles, lookback = 5, tolerance = 0.003, maxLevels = 6) {
  const pivots = []
  for (let i = lookback; i < candles.length - lookback; i++) {
    const win = candles.slice(i - lookback, i + lookback + 1)
    if (candles[i].high === Math.max(...win.map(c => c.high)))
      pivots.push({ price: candles[i].high, type: 'resistance' })
    if (candles[i].low === Math.min(...win.map(c => c.low)))
      pivots.push({ price: candles[i].low, type: 'support' })
  }
  const levels = []
  for (const p of pivots) {
    const ex = levels.find(l => l.type === p.type && Math.abs(l.price - p.price) / p.price < tolerance)
    if (ex) { ex.touches++; ex.price = (ex.price * (ex.touches - 1) + p.price) / ex.touches }
    else levels.push({ ...p, touches: 1 })
  }
  return levels.sort((a, b) => b.touches - a.touches).slice(0, maxLevels)
}

// ── Volume Profile Primitive (dibuja directo sobre el canvas del chart) ──────

class VPRenderer {
  constructor(profile, series) {
    this._p = profile
    this._s = series
  }
  draw(target) {
    const s = this._s
    const { buckets, bucketSize, minPrice, maxVol, pocPrice, vahPrice, valPrice } = this._p
    target.useBitmapCoordinateSpace(({ context: ctx, bitmapSize, horizontalPixelRatio, verticalPixelRatio }) => {
      const maxBarW = bitmapSize.width * 0.14
      for (let i = 0; i < buckets.length; i++) {
        const priceTop = minPrice + (i + 1) * bucketSize
        const priceBot = minPrice + i       * bucketSize
        const priceMid = minPrice + (i + 0.5) * bucketSize
        const y1css = s.priceToCoordinate(priceTop)
        const y2css = s.priceToCoordinate(priceBot)
        if (y1css === null || y2css === null) continue
        const y1   = y1css * verticalPixelRatio
        const y2   = y2css * verticalPixelRatio
        const barW = (buckets[i] / maxVol) * maxBarW
        const barH = Math.max(1, Math.abs(y2 - y1))
        const isPOC = Math.abs(priceMid - pocPrice) < bucketSize
        const isVA  = priceMid >= valPrice && priceMid <= vahPrice
        ctx.fillStyle = isPOC ? 'rgba(251,191,36,0.9)'
                      : isVA  ? 'rgba(96,165,250,0.5)'
                      :          'rgba(96,165,250,0.22)'
        ctx.fillRect(bitmapSize.width - barW, Math.min(y1, y2), barW, barH)
      }
    })
  }
}

class VPPaneView {
  constructor(profile, series) { this._p = profile; this._s = series }
  renderer() { return new VPRenderer(this._p, this._s) }
}

class VPPrimitive {
  constructor(profile) { this._p = profile; this._s = null }
  attached({ series }) { this._s = series }
  detached()           { this._s = null  }
  updateAllViews()     {}
  paneViews()          { return this._s ? [new VPPaneView(this._p, this._s)] : [] }
}

// ── Tema TradingView ─────────────────────────────────────────────────────────

const PRICE_SCALE_WIDTH = 90

const fmtSantiago = ts => new Date(ts * 1000).toLocaleString('es-CL', {
  timeZone: 'America/Santiago',
  month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit',
  hour12: false,
})

const TV_THEME = {
  layout:     { background: { color: '#131722' }, textColor: '#b2b5be' },
  grid:       { vertLines: { color: '#1e2130' }, horzLines: { color: '#1e2130' } },
  crosshair:  { mode: 1 },
  timeScale:  { borderColor: '#2a2e39', timeVisible: true, secondsVisible: false, tickMarkFormatter: fmtSantiago },
  localization: { timeFormatter: fmtSantiago },
  rightPriceScale: { borderColor: '#2a2e39', minimumWidth: PRICE_SCALE_WIDTH },
}

const TV_THEME_NO_TIME = {
  ...TV_THEME,
  timeScale: { borderColor: '#2a2e39', visible: false },
}

// ── Componente ───────────────────────────────────────────────────────────────

export default function Analysis() {
  const [mode, setMode]             = useState('crypto')
  const [pair, setPair]             = useState('BTC')
  const [stockSymbol, setStockSymbol] = useState('')
  const [stockError, setStockError]   = useState('')
  const [stockFavorites, setStockFavorites] = useState(() => {
    try { return JSON.parse(localStorage.getItem('stockFavorites')) || ['AAPL', 'TSLA', 'NVDA', 'MSFT', 'AMZN'] }
    catch { return ['AAPL', 'TSLA', 'NVDA', 'MSFT', 'AMZN'] }
  })
  const [editingFavorites, setEditingFavorites] = useState(false)
  const [addStockInput, setAddStockInput]       = useState('')
  const [interval, setInterval]     = useState('1h')
  const [candles, setCandles]   = useState([])
  const [loading, setLoading]   = useState(false)
  const [adxValue, setAdxValue] = useState(null)
  const [sqzState, setSqzState] = useState(null)
  const [srLevels, setSrLevels] = useState([])
  const [vpInfo, setVpInfo]     = useState(null)
  const [emaLast, setEmaLast]   = useState({ ema10: null, ema55: null })
  const [ohlcv, setOhlcv]       = useState(null)

  const priceRef   = useRef(null)
  const adxRef     = useRef(null)
  const sqzRef     = useRef(null)
  const priceChart = useRef(null)
  const adxChart   = useRef(null)
  const sqzChart   = useRef(null)
  const candleRef  = useRef(null)

  useEffect(() => {
    localStorage.setItem('stockFavorites', JSON.stringify(stockFavorites))
  }, [stockFavorites])

  useEffect(() => {
    if (mode === 'crypto' && !SYMBOLS[pair]) return
    if (mode === 'stocks' && !stockSymbol) return
    setLoading(true)
    setStockError('')
    const fetcher = mode === 'crypto'
      ? fetchCandles(pair, interval)
      : fetchCandlesStock(stockSymbol, interval)
    fetcher
      .then(d => { setCandles(d); setLoading(false) })
      .catch(() => { setLoading(false); if (mode === 'stocks') setStockError('Símbolo no encontrado') })
  }, [pair, interval, mode, stockSymbol])

  const rebuildCharts = useCallback(() => {
    if (!candles.length || !priceRef.current || !adxRef.current || !sqzRef.current) return

    if (priceChart.current) { priceChart.current.remove(); priceChart.current = null }
    if (adxChart.current)   { adxChart.current.remove();   adxChart.current   = null }
    if (sqzChart.current)   { sqzChart.current.remove();   sqzChart.current   = null }

    const closes = candles.map(c => c.close)
    const ema10  = calcEMA(closes, 10)
    const ema55  = calcEMA(closes, 55)
    const adx    = calcADX(candles)
    const { momentum, sqzOn, sqzOff } = calcSqueeze(candles)
    const sr     = calcSR(candles)
    const vp     = calcVolumeProfile(candles)

    const lastAdx = [...adx].reverse().find(v => v !== null)
    setAdxValue(lastAdx ? lastAdx.toFixed(1) : null)
    setSqzState(sqzOn[sqzOn.length - 1] ? 'on' : sqzOff[sqzOff.length - 1] ? 'off' : 'none')
    setSrLevels(sr)
    setVpInfo(vp)
    setEmaLast({
      ema10: [...ema10].reverse().find(v => v !== null),
      ema55: [...ema55].reverse().find(v => v !== null),
    })

    // ── Precio ───────────────────────────────────────────────────────────────
    const pc = createChart(priceRef.current, { ...TV_THEME_NO_TIME, height: 420, width: priceRef.current.clientWidth,
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: true,
      timeScale: { ...TV_THEME_NO_TIME.timeScale, rightOffset: 12, fixRightEdge: false, fixLeftEdge: false } })
    priceChart.current = pc

    const cs = pc.addSeries(CandlestickSeries, {
      upColor: '#26a69a', downColor: '#ef5350',
      borderUpColor: '#26a69a', borderDownColor: '#ef5350',
      wickUpColor: '#26a69a', wickDownColor: '#ef5350',
    })
    cs.setData(candles)
    candleRef.current = cs

    // EMA 10 / 55
    pc.addSeries(LineSeries, { color: '#60a5fa', lineWidth: 1.5, title: '', priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false })
      .setData(candles.map((c, i) => ema10[i] !== null ? { time: c.time, value: ema10[i] } : null).filter(Boolean))
    pc.addSeries(LineSeries, { color: '#a78bfa', lineWidth: 1.5, title: '', priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false })
      .setData(candles.map((c, i) => ema55[i] !== null ? { time: c.time, value: ema55[i] } : null).filter(Boolean))

    // Volumen como histograma superpuesto (escala separada)
    const volS = pc.addSeries(HistogramSeries, {
      priceScaleId: 'vol',
      priceLineVisible: false,
      lastValueVisible: false,
    })
    pc.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } })
    volS.setData(candles.map(c => ({
      time: c.time,
      value: c.volume,
      color: c.close >= c.open ? 'rgba(38,166,154,0.4)' : 'rgba(239,83,80,0.4)',
    })))

    // S/R como price lines — sin título flotante, solo etiqueta en el eje
    for (const lvl of sr) {
      const isRes = lvl.type === 'resistance'
      cs.createPriceLine({
        price: lvl.price,
        color: isRes ? 'rgba(239,83,80,0.6)' : 'rgba(38,166,154,0.6)',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: '',
      })
    }

    // Volume Profile: barras laterales via primitive + líneas POC/VAH/VAL
    cs.attachPrimitive(new VPPrimitive(vp))
    cs.createPriceLine({ price: vp.pocPrice, color: '#fbbf24', lineWidth: 1, lineStyle: 0, axisLabelVisible: true, title: '' })
    cs.createPriceLine({ price: vp.vahPrice, color: 'rgba(96,165,250,0.5)', lineWidth: 1, lineStyle: 3, axisLabelVisible: false, title: '' })
    cs.createPriceLine({ price: vp.valPrice, color: 'rgba(96,165,250,0.5)', lineWidth: 1, lineStyle: 3, axisLabelVisible: false, title: '' })

    pc.timeScale().fitContent()

    // OHLCV en crosshair
    pc.subscribeCrosshairMove(param => {
      if (!param.time || !param.seriesData) { setOhlcv(null); return }
      const bar = param.seriesData.get(cs)
      if (bar) setOhlcv({ ...bar, volume: candles.find(c => c.time === param.time)?.volume })
    })

    // ── ADX ──────────────────────────────────────────────────────────────────
    const SUB_TIMESCALE = { ...TV_THEME_NO_TIME.timeScale, rightOffset: 10, fixRightEdge: false, fixLeftEdge: false }
    const ac = createChart(adxRef.current, { ...TV_THEME_NO_TIME, height: 140, width: adxRef.current.clientWidth,
      handleScroll: false, handleScale: false,
      timeScale: SUB_TIMESCALE })
    adxChart.current = ac
    const adxS = ac.addSeries(LineSeries, { color: '#fbbf24', lineWidth: 2, title: '', priceLineVisible: false, lastValueVisible: false })
    adxS.setData(candles.map((c, i) => adx[i] !== null ? { time: c.time, value: adx[i] } : null).filter(Boolean))
    adxS.createPriceLine({ price: 23, color: 'rgba(239,68,68,0.5)', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '' })
    // ── Squeeze ───────────────────────────────────────────────────────────────
    const sc = createChart(sqzRef.current, { ...TV_THEME, height: 140, width: sqzRef.current.clientWidth,
      handleScroll: false, handleScale: false,
      timeScale: { ...TV_THEME.timeScale, rightOffset: 10, fixRightEdge: false, fixLeftEdge: false } })
    sqzChart.current = sc
    const sqzS = sc.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false })
    sqzS.setData(candles.map((c, i) => {
      if (momentum[i] === null) return null
      const v = momentum[i], prev = momentum[i - 1] ?? v
      const color = v >= 0 ? (v >= prev ? '#26a69a' : '#80cbc4') : (v <= prev ? '#ef5350' : '#ffcdd2')
      return { time: c.time, value: v, color }
    }).filter(Boolean))

    // Expande el rightOffset dinámicamente cuando el usuario scrollea al límite derecho
    const lastTime = candles[candles.length - 1].time
    let currentRightOffset = 12
    priceRef.current.addEventListener('wheel', e => {
      if (e.deltaX <= 0) return
      const range = pc.timeScale().getVisibleRange()
      if (!range) return
      const intervalSec = candles.length > 1 ? candles[1].time - candles[0].time : 3600
      const barsFromRight = (range.to - lastTime) / intervalSec
      if (barsFromRight >= currentRightOffset - 2) {
        currentRightOffset += 8
        pc.applyOptions({ timeScale: { rightOffset: currentRightOffset } })
      }
    }, { passive: true })

    // Sync por timestamp real (no por índice lógico) para que los warmups no desalineen
    let syncing = false
    const charts = [pc, ac, sc]
    charts.forEach(src => {
      src.timeScale().subscribeVisibleTimeRangeChange(r => {
        if (syncing || !r) return
        syncing = true
        charts.filter(t => t !== src).forEach(t => t.timeScale().setVisibleRange(r))
        syncing = false
      })
    })
    pc.timeScale().fitContent()

    requestAnimationFrame(() => {
      const range = pc.timeScale().getVisibleRange()
      if (range) {
        ac.timeScale().setVisibleRange(range)
        sc.timeScale().setVisibleRange(range)
      }
    })

    // Resize
    const obs = new ResizeObserver(() => {
      if (priceRef.current) pc.applyOptions({ width: priceRef.current.clientWidth })
      if (adxRef.current)   ac.applyOptions({ width: adxRef.current.clientWidth })
      if (sqzRef.current)   sc.applyOptions({ width: sqzRef.current.clientWidth })
    })
    obs.observe(priceRef.current)

    return () => {
      obs.disconnect()
      if (priceChart.current) { priceChart.current.remove(); priceChart.current = null }
      if (adxChart.current)   { adxChart.current.remove();   adxChart.current   = null }
      if (sqzChart.current)   { sqzChart.current.remove();   sqzChart.current   = null }
    }
  }, [candles])

  useEffect(rebuildCharts, [candles])

  const isLateral = adxValue !== null && parseFloat(adxValue) < 23
  const sqzLabel  = sqzState === 'on'  ? { text: 'COMPRIMIDO', cls: 'text-yellow-400' }
                  : sqzState === 'off' ? { text: 'LIBERADO',   cls: 'text-red-400'    }
                  :                      { text: '—',           cls: 'text-gray-500'   }

  return (
    <div className="flex flex-col gap-4">

      {/* Header */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-lg font-bold text-white">Análisis Técnico</h1>
          <div className="flex gap-2">
            <button onClick={() => setMode('crypto')}
              className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-colors
                ${mode === 'crypto' ? 'bg-purple-700 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
              Crypto
            </button>
            <button onClick={() => { setMode('stocks'); setStockSymbol(''); setStockError(''); setEditingFavorites(false) }}
              className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-colors
                ${mode === 'stocks' ? 'bg-blue-700 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
              Acciones
            </button>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          {mode === 'crypto' ? (
            Object.keys(SYMBOLS).map(p => (
              <button key={p} onClick={() => setPair(p)}
                className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-colors
                  ${pair === p ? 'bg-purple-700 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
                {p}
              </button>
            ))
          ) : (
            <>
              {stockFavorites.map(sym => (
                <div key={sym} className="relative">
                  <button
                    onClick={() => { if (!editingFavorites) { setStockSymbol(sym); setStockError('') } }}
                    className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-colors
                      ${stockSymbol === sym && !editingFavorites
                        ? 'bg-blue-700 text-white'
                        : editingFavorites
                          ? 'bg-gray-800 text-gray-500 cursor-default'
                          : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
                    {sym}
                  </button>
                  {editingFavorites && (
                    <button
                      onClick={() => setStockFavorites(prev => prev.filter(s => s !== sym))}
                      className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-600 rounded-full text-white text-xs flex items-center justify-center hover:bg-red-500 leading-none">
                      ×
                    </button>
                  )}
                </div>
              ))}

              {editingFavorites && (
                <form
                  onSubmit={e => {
                    e.preventDefault()
                    const s = addStockInput.trim().toUpperCase()
                    if (s && !stockFavorites.includes(s)) setStockFavorites(prev => [...prev, s])
                    setAddStockInput('')
                  }}
                  className="flex gap-1 items-center">
                  <input
                    type="text"
                    value={addStockInput}
                    onChange={e => setAddStockInput(e.target.value.toUpperCase())}
                    placeholder="Símbolo..."
                    autoFocus
                    className="bg-gray-800 text-white text-sm px-2 py-1.5 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500 w-28"
                  />
                  <button type="submit"
                    className="px-2.5 py-1.5 rounded-lg text-sm font-bold bg-blue-700 text-white hover:bg-blue-600 transition-colors">
                    +
                  </button>
                </form>
              )}

              <button
                onClick={() => setEditingFavorites(v => !v)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-colors
                  ${editingFavorites ? 'bg-gray-600 text-white' : 'bg-gray-800 text-gray-500 hover:text-white'}`}>
                {editingFavorites ? 'Listo' : '✎'}
              </button>

              {stockError && <span className="text-red-400 text-xs">{stockError}</span>}
            </>
          )}
          <div className="w-px bg-gray-700 mx-1" />
          {Object.entries(INTERVALS).map(([k, v]) => (
            <button key={k} onClick={() => setInterval(k)}
              className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-colors
                ${interval === k ? 'bg-blue-700 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label={mode === 'crypto' ? 'Par' : 'Acción'} value={mode === 'crypto' ? pair : (stockSymbol || '—')} />
        <StatCard label="Temporalidad" value={INTERVALS[interval].label} />
        <div className="relative group bg-gray-900 border border-gray-800 rounded-xl p-4 cursor-default">
          <p className="text-xs text-gray-500 flex items-center gap-1">
            ADX (14)
            <span className="text-gray-600 group-hover:text-gray-400 transition-colors text-xs">?</span>
          </p>
          <p className={`text-lg font-bold mt-1 ${isLateral ? 'text-green-400' : 'text-yellow-400'}`}>
            {loading ? '...' : adxValue ?? '—'}
          </p>
          {(isLateral || adxValue) && (
            <p className="text-xs text-gray-500 mt-0.5">{isLateral ? 'LATERAL ✓' : 'CON TENDENCIA'}</p>
          )}
          <div className="absolute top-full left-0 mt-2 w-64 z-50 hidden group-hover:block
            bg-gray-900 border border-gray-700 rounded-xl p-3 shadow-xl text-xs text-gray-300 leading-relaxed">
            <p className="text-white font-bold mb-2">ADX — Average Directional Index</p>
            <p className="text-gray-400 mb-2">Mide la fuerza de la tendencia, no su dirección. Va de 0 a 100.</p>
            <div className="flex flex-col gap-2">
              <div className="flex items-start gap-2">
                <span className="w-2 h-2 rounded-sm bg-green-400 mt-0.5 shrink-0"/>
                <span><span className="text-green-400 font-bold">ADX &lt; 23</span> — Mercado lateral. Ideal para abrir pool de liquidez en Uniswap v3.</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="w-2 h-2 rounded-sm bg-yellow-400 mt-0.5 shrink-0"/>
                <span><span className="text-yellow-400 font-bold">23 – 50</span> — Tendencia moderada. Riesgo de IL elevado en pools.</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="w-2 h-2 rounded-sm bg-red-400 mt-0.5 shrink-0"/>
                <span><span className="text-red-400 font-bold">ADX &gt; 50</span> — Tendencia fuerte. No recomendado para LP.</span>
              </div>
            </div>
          </div>
        </div>
        <div className="relative group bg-gray-900 border border-gray-800 rounded-xl p-4 cursor-default">
          <p className="text-xs text-gray-500 flex items-center gap-1">
            Squeeze
            <span className="text-gray-600 group-hover:text-gray-400 transition-colors text-xs">?</span>
          </p>
          <p className={`text-lg font-bold mt-1 ${sqzLabel.cls}`}>{loading ? '...' : sqzLabel.text}</p>
          <div className="absolute top-full left-0 mt-2 w-64 z-50 hidden group-hover:block
            bg-gray-900 border border-gray-700 rounded-xl p-3 shadow-xl text-xs text-gray-300 leading-relaxed">
            <p className="text-white font-bold mb-2">Squeeze Momentum</p>
            <div className="flex flex-col gap-2">
              <div className="flex items-start gap-2">
                <span className="w-2 h-2 rounded-sm bg-yellow-400 mt-0.5 shrink-0"/>
                <span><span className="text-yellow-400 font-bold">COMPRIMIDO</span> — precio acumulando energía dentro de un rango estrecho. Se espera un movimiento explosivo próximo.</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="w-2 h-2 rounded-sm bg-red-400 mt-0.5 shrink-0"/>
                <span><span className="text-red-400 font-bold">LIBERADO</span> — el squeeze se disparó, el precio está en movimiento. Ver dirección del histograma.</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="w-2 h-2 rounded-sm bg-gray-500 mt-0.5 shrink-0"/>
                <span><span className="text-gray-400 font-bold">—</span> sin squeeze activo, mercado en estado normal.</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Alerta lateral */}
      {isLateral && !loading && (
        <div className="bg-green-950 border border-green-700 rounded-xl px-4 py-3 text-sm text-green-300">
          <span className="font-bold">ADX &lt; 23</span> — Mercado en lateral. Momento para evaluar apertura de pool.
          Verifica S/R y Volume Profile para definir el rango.
        </div>
      )}

      {/* Info VP + S/R */}
      {vpInfo && !loading && (
        <div className="flex gap-4 text-xs flex-wrap">
          <span className="text-gray-500">Volume Profile:</span>
          <span className="text-yellow-400 font-bold">POC ${vpInfo.pocPrice.toFixed(0)}</span>
          <span className="text-blue-400">VAH ${vpInfo.vahPrice.toFixed(0)}</span>
          <span className="text-blue-400">VAL ${vpInfo.valPrice.toFixed(0)}</span>
          {srLevels.length > 0 && <>
            <span className="text-gray-500 ml-2">S/R:</span>
            {srLevels.map((l, i) => (
              <span key={i} className={l.type === 'resistance' ? 'text-red-400' : 'text-green-400'}>
                {l.type === 'resistance' ? 'R' : 'S'} ${l.price.toFixed(0)} ({l.touches})
              </span>
            ))}
          </>}
        </div>
      )}

      {loading && (
        <div className="h-64 flex items-center justify-center text-gray-500 text-sm">
          {mode === 'crypto' ? 'Cargando datos de Binance...' : `Cargando ${stockSymbol}...`}
        </div>
      )}

      {!loading && (
        <div className="rounded-xl overflow-hidden border border-gray-800" style={{ background: '#131722' }}>

          {/* Leyenda precio */}
          <div className="flex gap-5 px-4 pt-3 pb-1 text-xs text-gray-500 flex-wrap items-center">
            <span className="text-gray-400 font-bold">{mode === 'crypto' ? pair : stockSymbol}</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-blue-400 inline-block" />EMA 10</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-purple-400 inline-block" />EMA 55</span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-green-400 inline-block" />Soporte</span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-red-400 inline-block" />Resistencia</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-yellow-400 inline-block" />POC</span>
            {ohlcv && (
              <span className="ml-auto flex gap-3 font-mono text-xs">
                <span>O <span className="text-white">{ohlcv.open?.toFixed(2)}</span></span>
                <span>H <span className="text-green-400">{ohlcv.high?.toFixed(2)}</span></span>
                <span>L <span className="text-red-400">{ohlcv.low?.toFixed(2)}</span></span>
                <span>C <span className={ohlcv.close >= ohlcv.open ? 'text-green-400' : 'text-red-400'}>{ohlcv.close?.toFixed(2)}</span></span>
              </span>
            )}
          </div>

          <div ref={priceRef} className="w-full" />

          <div className="px-4 pt-2 pb-0 text-xs text-yellow-400 font-bold" style={{ background: '#131722' }}>
            ADX (14) — línea roja = 23
          </div>
          <div ref={adxRef} className="w-full" />

          <div className="relative px-4 pt-2 pb-0 text-xs text-gray-400 font-bold group" style={{ background: '#131722' }}>
            Squeeze Momentum
            <span className="ml-1.5 text-gray-600 cursor-help group-hover:text-gray-400 transition-colors">?</span>
            <div className="absolute left-4 bottom-full mb-2 w-72 z-50 hidden group-hover:block
              bg-gray-900 border border-gray-700 rounded-xl p-3 shadow-xl text-xs font-normal text-gray-300 leading-relaxed">
              <p className="text-white font-bold mb-2">Squeeze Momentum (LazyBear)</p>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-start gap-2">
                  <span className="w-2 h-2 rounded-sm bg-yellow-400 mt-0.5 shrink-0"/>
                  <span><span className="text-yellow-400 font-bold">COMPRIMIDO</span> — Las Bandas de Bollinger están dentro del Canal de Keltner. El precio acumula energía. Se espera un movimiento explosivo próximo.</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="w-2 h-2 rounded-sm bg-red-400 mt-0.5 shrink-0"/>
                  <span><span className="text-red-400 font-bold">LIBERADO</span> — El squeeze se disparó. El precio está en movimiento. Observar la dirección del histograma para confirmar tendencia.</span>
                </div>
                <div className="border-t border-gray-700 mt-1 pt-1.5 flex flex-col gap-1">
                  <span className="text-gray-400 font-bold mb-0.5">Histograma:</span>
                  <span className="flex items-center gap-2"><span className="w-3 h-2 rounded-sm bg-green-400 inline-block shrink-0"/>Verde oscuro — impulso alcista creciendo</span>
                  <span className="flex items-center gap-2"><span className="w-3 h-2 rounded-sm bg-green-200 inline-block shrink-0"/>Verde claro — impulso alcista desacelerando</span>
                  <span className="flex items-center gap-2"><span className="w-3 h-2 rounded-sm bg-red-400 inline-block shrink-0"/>Rojo oscuro — impulso bajista creciendo</span>
                  <span className="flex items-center gap-2"><span className="w-3 h-2 rounded-sm bg-red-200 inline-block shrink-0"/>Rojo claro — impulso bajista desacelerando</span>
                </div>
              </div>
            </div>
          </div>
          <div ref={sqzRef} className="w-full pb-2" />
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, sub, color = 'text-white' }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-lg font-bold mt-1 ${color}`}>{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
    </div>
  )
}
