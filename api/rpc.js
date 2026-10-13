// Server-side Base RPC proxy. Key stays in process.env.ALCHEMY_API_KEY.
const ALLOWED = new Set(['eth_call','eth_chainId','eth_blockNumber','eth_getBalance','eth_estimateGas','eth_getCode','eth_gasPrice','eth_getTransactionReceipt']);
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const calls = Array.isArray(body) ? body : [body];
  if (calls.length > 50 || calls.some(c => !ALLOWED.has(c?.method))) return res.status(400).json({ error: 'method not allowed' });
  const key = process.env.ALCHEMY_API_KEY;
  const url = key ? `https://base-mainnet.g.alchemy.com/v2/${key}` : 'https://mainnet.base.org';
  try {
    let r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    let j = await r.json();
    // Fall back to public RPC if Alchemy rejects (e.g. Base not enabled on the app)
    if (key && (!r.ok || (!Array.isArray(j) && j.error && j.error.code === -32600))) {
      r = await fetch('https://mainnet.base.org', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      j = await r.json();
    }
    res.setHeader('cache-control', 'no-store');
    return res.status(200).json(j);
  } catch (e) { return res.status(502).json({ error: 'upstream failed' }); }
}
