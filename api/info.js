export default async function handler(req, res) {
  const { symbol } = req.query
  if (!symbol) return res.status(400).json({ error: 'Missing symbol' })

  const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  const sym = symbol.toUpperCase()

  const [searchRes, summaryRes] = await Promise.allSettled([
    fetch(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(sym)}&quotesCount=1&newsCount=0`, { headers }),
    fetch(`https://query1.finance.yahoo.com/v11/finance/quoteSummary/${encodeURIComponent(sym)}?modules=assetProfile,fundProfile`, { headers }),
  ])

  const info = {}

  if (searchRes.status === 'fulfilled' && searchRes.value.ok) {
    const d = await searchRes.value.json()
    const q = d.quotes?.find(q => q.symbol?.toUpperCase() === sym)
    if (q) {
      info.name     = q.longname || q.shortname
      info.sector   = q.sector   || null
      info.industry = q.industry || null
    }
  }

  if (summaryRes.status === 'fulfilled' && summaryRes.value.ok) {
    const d = await summaryRes.value.json()
    const r  = d.quoteSummary?.result?.[0]
    const ap = r?.assetProfile ?? {}
    const fp = r?.fundProfile  ?? {}
    if (ap.longBusinessSummary) info.desc = ap.longBusinessSummary
    if (!info.sector   && ap.sector)       info.sector   = ap.sector
    if (!info.industry && ap.industry)     info.industry = ap.industry
    if (!info.sector   && fp.categoryName) info.sector   = fp.categoryName
  }

  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate')
  res.json(info)
}
