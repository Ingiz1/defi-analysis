export default async function handler(req, res) {
  const { symbol, interval, range } = req.query
  if (!symbol || !interval || !range) {
    return res.status(400).json({ error: 'Missing params' })
  }
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&includePrePost=false`
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  })
  const data = await response.json()
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate')
  res.json(data)
}
