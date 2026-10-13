import { createCoinbaseWalletSDK } from '@coinbase/wallet-sdk'
import { formatUnits, parseUnits, isAddress, getAddress, type Address, type Hex } from 'viem'
import * as L from './lib'

const $ = (s: string) => document.querySelector(s) as HTMLElement
const app = $('#app'), sheet = $('#sheet'), btn = $('#connect') as HTMLButtonElement
let provider: any = null, account: Address | null = null
let viewAddr: Address | null = null
let slip = Number(localStorage.getItem('slipBps') || 50)
const positions = new Map<string, L.Position>()

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[c])
const short = (a: string) => a.slice(0, 6) + '…' + a.slice(-4)
const fmt = (v: bigint, d: number, max = 6) => { const n = Number(formatUnits(v, d)); return n === 0 ? '0' : n < 1e-6 ? n.toExponential(3) : n.toLocaleString(undefined, { maximumFractionDigits: max }) }
const fp = (n: number) => !isFinite(n) ? '∞' : n === 0 ? '0' : (n < 1e-4 || n > 1e12) ? n.toExponential(4) : n.toLocaleString(undefined, { maximumSignificantDigits: 6 })
const addrLink = (a: string, label?: string) => `<a href="${L.SCAN}/address/${a}" target="_blank" rel="noopener">${label || short(a)}</a>`
function toast(m: string, ms = 3500) { const t = $('#toast'); t.textContent = m; t.style.display = 'block'; clearTimeout((t as any)._h); (t as any)._h = setTimeout(() => t.style.display = 'none', ms) }

// ---------- wallet ----------
function setBtn() { btn.textContent = account ? short(account) : 'Connect wallet'; btn.classList.toggle('on', !!account) }
async function useProvider(p: any) {
  const accs: string[] = await p.request({ method: 'eth_requestAccounts' })
  try { await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x2105' }] }) } catch { }
  provider = p; account = getAddress(accs[0]); setBtn()
  p.on?.('accountsChanged', (a: string[]) => { account = a[0] ? getAddress(a[0]) : null; setBtn(); if (account) load(account) })
  viewAddr = account; (document.getElementById('addr') as HTMLInputElement).value = account; load(account)
}
btn.onclick = () => {
  if (account) { if (confirm('Disconnect wallet?')) { provider?.disconnect?.(); account = null; provider = null; setBtn() } return }
  const inj = (window as any).ethereum
  openSheet('Connect wallet', `
    <button class="b" id="w-cb" style="width:100%;margin:8px 0">Coinbase Smart Wallet</button>
    ${inj ? '<button class="b g" id="w-inj" style="width:100%;margin:8px 0">Browser wallet (injected)</button>' : '<p class="muted">No browser wallet detected. Smart Wallet works in any phone browser with a passkey.</p>'}`)
  $('#w-cb').onclick = async () => {
    try {
      const sdk = createCoinbaseWalletSDK({ appName: 'LP Manager', appChainIds: [8453], preference: { options: 'smartWalletOnly' } })
      closeSheet(); await useProvider(sdk.getProvider())
    } catch (e: any) { toast(e.message || 'connect failed') }
  }
  const wi = document.getElementById('w-inj'); if (wi) wi.onclick = async () => { try { closeSheet(); await useProvider(inj) } catch (e: any) { toast(e.message || 'connect failed') } }
}
async function sendTx(to: Address, data: Hex, value = 0n, label = 'tx') {
  if (!provider || !account) { toast('Connect wallet first'); throw new Error('no wallet') }
  try { await L.simulate(account, to, data, value) } catch (e: any) {
    if (!confirm(`Simulation of ${label} failed:\n${e.shortMessage || e.message}\n\nSend anyway?`)) throw e
  }
  const hash = await provider.request({ method: 'eth_sendTransaction', params: [{ from: account, to, data, value: '0x' + value.toString(16), chainId: '0x2105' }] })
  toast(`${label} sent: ${short(hash)}`, 6000)
  for (let i = 0; i < 60; i++) { await new Promise(r => setTimeout(r, 2000)); const r = await L.client.request({ method: 'eth_getTransactionReceipt', params: [hash] }).catch(() => null) as any; if (r) { toast(`${label} ${r.status === '0x1' ? 'confirmed' : 'FAILED'}`); return hash } }
  return hash
}

// ---------- list ----------
function shell() {
  app.innerHTML = `
  <div class="card"><div class="muted">View positions for any address (read-only) or connect.</div>
   <div class="row" style="margin-top:8px"><input id="addr" placeholder="0x… wallet address"><button class="b" id="go">View</button></div>
   <div class="row" style="margin-top:8px"><input id="tid" placeholder="or position NFT id, e.g. 755630" inputmode="numeric"><button class="b g" id="goid">Open</button></div>
   <div class="row muted" style="margin-top:8px;justify-content:space-between"><span>Slippage</span><span><select id="slip" style="width:auto">${[10, 50, 100, 300, 500].map(b => `<option value="${b}" ${b === slip ? 'selected' : ''}>${b / 100}%</option>`).join('')}</select></span></div>
  </div><div id="list"></div>`
  $('#go').onclick = () => { const v = ($('#addr') as HTMLInputElement).value.trim(); if (!isAddress(v)) return toast('Not a valid address'); viewAddr = getAddress(v); history.replaceState(null, '', '?addr=' + viewAddr); load(viewAddr) }
  $('#goid').onclick = async () => { const v = ($('#tid') as HTMLInputElement).value.trim(); if (!/^\d+$/.test(v)) return toast('Enter a numeric id'); try { const p = await L.loadPosition(BigInt(v)); positions.set(v, p); openDetail(p) } catch (e: any) { toast('Not found: ' + (e.shortMessage || e.message)) } }
  $('#slip').onchange = e => { slip = Number((e.target as HTMLSelectElement).value); localStorage.setItem('slipBps', String(slip)) }
}
function card(p: L.Position) {
  const inR = p.tick >= p.tickLower && p.tick < p.tickUpper
  const price = L.priceFromSqrt(p.sqrtPriceX96, p.t0.decimals, p.t1.decimals)
  return `<div class="card pcard" data-id="${p.tokenId}">
   <div class="row" style="justify-content:space-between"><span class="pair">${esc(p.t0.symbol)} / ${esc(p.t1.symbol)}</span><span class="pill ${inR ? '' : 'out'}">${p.liquidity === 0n ? 'closed' : inR ? 'in range' : 'out of range'}</span></div>
   <div class="muted">#${p.tokenId} · v4 · ${(p.key.fee / 10000).toFixed(2)}% · ${p.key.hooks === L.ZERO ? 'no hook' : 'hook ' + short(p.key.hooks)}</div>
   <div class="kv"><span>Amounts</span><span>${fmt(p.amount0, p.t0.decimals, 2)} ${esc(p.t0.symbol)} · ${fmt(p.amount1, p.t1.decimals, 4)} ${esc(p.t1.symbol)}</span></div>
   <div class="kv"><span>Unclaimed fees</span><span>${fmt(p.fees0, p.t0.decimals, 2)} ${esc(p.t0.symbol)} · ${fmt(p.fees1, p.t1.decimals)} ${esc(p.t1.symbol)}</span></div>
   <div class="kv"><span>Price</span><span>1 ${esc(p.t0.symbol)} = ${fp(price)} ${esc(p.t1.symbol)}</span></div></div>`
}
async function load(owner: Address) {
  const list = $('#list'); list.innerHTML = '<p class="muted">Loading positions…</p>'
  let ids: bigint[]
  try { ids = await L.listTokenIds(owner) } catch (e: any) { list.innerHTML = `<p class="muted">Couldn't list NFTs (${esc(e.message)}). Open a position by NFT id above.</p>`; return }
  if (!ids.length) { list.innerHTML = '<p class="muted">No Uniswap v4 positions found for this address on Base.</p>'; return }
  list.innerHTML = `<p class="muted">${ids.length} v4 position${ids.length > 1 ? 's' : ''} for ${addrLink(owner)}</p>`
  const res = await Promise.allSettled(ids.map(id => L.loadPosition(id)))
  const ok = res.flatMap(r => r.status === 'fulfilled' ? [r.value] : []).sort((a, b) => Number(b.liquidity > 0n) - Number(a.liquidity > 0n))
  for (const p of ok) positions.set(String(p.tokenId), p)
  list.innerHTML += ok.map(card).join('')
  list.querySelectorAll('.pcard').forEach(el => (el as HTMLElement).onclick = () => openDetail(positions.get((el as HTMLElement).dataset.id!)!))
}

// ---------- detail ----------
function openSheet(title: string, html: string) { sheet.innerHTML = `<div class="top"><h2>${title}</h2><button class="b g" id="close">✕</button></div>${html}`; sheet.classList.remove('hidden'); $('#close').onclick = closeSheet }
function closeSheet() { sheet.classList.add('hidden'); sheet.innerHTML = '' }
function tokenBlock(t: L.Token, label: string, price: string) {
  return `<div class="card"><div class="pair">${label}: ${esc(t.symbol)}</div>
  <div class="kv"><span>Name</span><span>${esc(t.name)}</span></div>
  <div class="kv"><span>Address</span><span>${t.native ? 'native ETH' : addrLink(t.address, t.address)}</span></div>
  <div class="kv"><span>Decimals</span><span>${t.decimals}</span></div>
  ${t.native ? '' : `<div class="kv"><span>Total supply</span><span>${fmt(t.totalSupply, t.decimals, 2)}</span></div>`}
  <div class="kv"><span>Price</span><span>${price}</span></div>
  ${t.native ? '' : `<div class="kv"><span>Links</span><span>${addrLink(t.address, 'BaseScan')} · <a target="_blank" href="https://dexscreener.com/base/${t.address}">DexScreener</a></span></div>`}</div>`
}
function openDetail(p: L.Position) {
  const price = L.priceFromSqrt(p.sqrtPriceX96, p.t0.decimals, p.t1.decimals)
  const lo = L.priceAtTick(p.tickLower, p.t0.decimals, p.t1.decimals), hi = L.priceAtTick(p.tickUpper, p.t0.decimals, p.t1.decimals)
  const full = p.tickLower <= -887000 && p.tickUpper >= 887000
  const share = p.poolLiquidity ? Number(p.liquidity * 10000n / p.poolLiquidity) / 100 : 0
  const mine = account && account.toLowerCase() === p.owner.toLowerCase()
  openSheet(`${esc(p.t0.symbol)} / ${esc(p.t1.symbol)} #${p.tokenId}`, `
  <div class="card">
   <div class="kv"><span>Owner</span><span>${addrLink(p.owner)}${mine ? ' (you)' : ''}</span></div>
   <div class="kv"><span>Position NFT</span><span><a target="_blank" href="${L.SCAN}/nft/${L.PM}/${p.tokenId}">BaseScan</a> · <a target="_blank" href="https://app.uniswap.org/positions/v4/base/${p.tokenId}">Uniswap</a></span></div>
   <div class="kv"><span>Pool id</span><span><code>${p.poolId}</code></span></div>
   <div class="kv"><span>Fee / tick spacing</span><span>${(p.key.fee / 10000).toFixed(2)}% (live ${(p.lpFee / 10000).toFixed(2)}%) / ${p.key.tickSpacing}</span></div>
   <div class="kv"><span>Hooks</span><span>${p.key.hooks === L.ZERO ? 'none' : addrLink(p.key.hooks)}</span></div>
   <div class="kv"><span>Range</span><span>${full ? 'Full range' : `${fp(lo)} – ${fp(hi)}`} <span class="muted">(ticks ${p.tickLower}…${p.tickUpper})</span></span></div>
   <div class="kv"><span>Current tick</span><span>${p.tick}</span></div>
   <div class="kv"><span>Price</span><span>1 ${esc(p.t0.symbol)} = ${fp(price)} ${esc(p.t1.symbol)}<br>1 ${esc(p.t1.symbol)} = ${fp(1 / price)} ${esc(p.t0.symbol)}</span></div>
   <div class="kv"><span>Liquidity</span><span>${p.liquidity} (${share}% of pool)</span></div>
   <div class="kv"><span>Amounts</span><span>${fmt(p.amount0, p.t0.decimals)} ${esc(p.t0.symbol)}<br>${fmt(p.amount1, p.t1.decimals)} ${esc(p.t1.symbol)}</span></div>
   <div class="kv"><span>Unclaimed fees</span><span>${fmt(p.fees0, p.t0.decimals)} ${esc(p.t0.symbol)}<br>${fmt(p.fees1, p.t1.decimals)} ${esc(p.t1.symbol)}</span></div>
  </div>
  ${tokenBlock(p.t0, 'Token 0', `${fp(price)} ${esc(p.t1.symbol)}`)}
  ${tokenBlock(p.t1, 'Token 1', `${fp(1 / price)} ${esc(p.t0.symbol)}`)}
  <h2>Actions</h2>${mine ? '' : '<p class="muted">Connect the owner wallet to act. Read-only view.</p>'}
  <div class="tabs">${['Claim', 'Remove', 'Add', 'Transfer', 'Send token'].map(t => `<button class="b g" data-t="${t}">${t}</button>`).join('')}</div>
  <div id="act" class="card"><span class="muted">Pick an action. Slippage: ${slip / 100}%</span></div>`)
  sheet.querySelectorAll('.tabs button').forEach(b => (b as HTMLElement).onclick = () => { sheet.querySelectorAll('.tabs button').forEach(x => x.classList.remove('act')); b.classList.add('act'); renderAction(p, (b as HTMLElement).dataset.t!) })
}
async function refresh(p: L.Position) { const n = await L.loadPosition(p.tokenId); positions.set(String(n.tokenId), n); openDetail(n) }
function need(): Address { if (!account) { toast('Connect wallet first'); throw new Error('x') } return account }

async function ensureApprovals(t: L.Token, amt: bigint) {
  if (t.native || amt === 0n) return
  const me = need()
  const a1 = await L.client.readContract({ address: t.address, abi: L.ercAbi, functionName: 'allowance', args: [me, L.PERMIT2] })
  if (a1 < amt) await sendTx(t.address, L.approveCalldata(L.PERMIT2), 0n, `Approve ${t.symbol} → Permit2`)
  const [a2, exp] = await L.client.readContract({ address: L.PERMIT2, abi: L.p2Abi, functionName: 'allowance', args: [me, t.address, L.PM] })
  if (a2 < amt || exp < Date.now() / 1000 + 60) await sendTx(L.PERMIT2, L.permit2ApproveCalldata(t.address), 0n, `Permit2 ${t.symbol} → PositionManager`)
}
function renderAction(p: L.Position, t: string) {
  const act = $('#act'), s0 = esc(p.t0.symbol), s1 = esc(p.t1.symbol)
  if (t === 'Claim') {
    act.innerHTML = `<div class="kv"><span>Collect</span><span>${fmt(p.fees0, p.t0.decimals)} ${s0} + ${fmt(p.fees1, p.t1.decimals)} ${s1}</span></div><button class="b" id="do" style="width:100%;margin-top:10px">Claim fees</button>`
    $('#do').onclick = async () => { const me = need(); await sendTx(L.PM, L.claimCalldata(p, me), 0n, 'Claim fees'); refresh(p) }
  } else if (t === 'Remove') {
    act.innerHTML = `<div class="row" style="justify-content:space-between"><span>Remove</span><b id="pv">50%</b></div><input type="range" id="pct" min="1" max="100" value="50">
     <div class="row" style="margin:6px 0">${[25, 50, 75, 100].map(v => `<button class="b g q" data-v="${v}" style="flex:1">${v}%</button>`).join('')}</div>
     <div class="kv"><span>You receive ≈</span><span id="rv"></span></div><div class="muted">Includes unclaimed fees. Min with ${slip / 100}% slippage.</div>
     <button class="b" id="do" style="width:100%;margin-top:10px">Remove liquidity</button>`
    const pct = $('#pct') as HTMLInputElement
    const upd = () => { const v = Number(pct.value); $('#pv').textContent = v + '%'; const Lq = p.liquidity * BigInt(v) / 100n; const [a0, a1] = L.amountsForLiquidity(p.sqrtPriceX96, L.sqrtAtTick(p.tickLower), L.sqrtAtTick(p.tickUpper), Lq); $('#rv').innerHTML = `${fmt(a0 + p.fees0, p.t0.decimals)} ${s0}<br>${fmt(a1 + p.fees1, p.t1.decimals)} ${s1}` }
    pct.oninput = upd; act.querySelectorAll('.q').forEach(b => (b as HTMLElement).onclick = () => { pct.value = (b as HTMLElement).dataset.v!; upd() }); upd()
    $('#do').onclick = async () => { const me = need(); await sendTx(L.PM, L.removeCalldata(p, Number(pct.value), slip, me), 0n, 'Remove liquidity'); refresh(p) }
  } else if (t === 'Add') {
    act.innerHTML = `<label class="muted">${s0} amount</label><input id="a0" inputmode="decimal" placeholder="0.0"><label class="muted">${s1} amount</label><input id="a1" inputmode="decimal" placeholder="0.0">
     <div class="muted" id="bal" style="margin-top:6px"></div><div class="muted">Amounts stay in ratio with the position's range (typing one fills the other). Max uses ${slip / 100}% slippage. Approvals (token → Permit2 → PositionManager) are requested first if needed.</div>
     <button class="b" id="do" style="width:100%;margin-top:10px">Add liquidity</button>`
    const i0 = $('#a0') as HTMLInputElement, i1 = $('#a1') as HTMLInputElement
    const sa = L.sqrtAtTick(p.tickLower), sb = L.sqrtAtTick(p.tickUpper)
    const big = 10n ** 40n
    i0.oninput = () => { try { const a = parseUnits(i0.value || '0', p.t0.decimals); const Lq = L.liquidityForAmounts(p.sqrtPriceX96, sa, sb, a, big); i1.value = formatUnits(L.amountsForLiquidity(p.sqrtPriceX96, sa, sb, Lq)[1], p.t1.decimals) } catch { } }
    i1.oninput = () => { try { const a = parseUnits(i1.value || '0', p.t1.decimals); const Lq = L.liquidityForAmounts(p.sqrtPriceX96, sa, sb, big, a); i0.value = formatUnits(L.amountsForLiquidity(p.sqrtPriceX96, sa, sb, Lq)[0], p.t0.decimals) } catch { } }
    if (account) Promise.all([p.t0, p.t1].map(t => t.native ? L.client.getBalance({ address: account! }) : L.client.readContract({ address: t.address, abi: L.ercAbi, functionName: 'balanceOf', args: [account!] }))).then(([b0, b1]) => $('#bal').textContent = `Balance: ${fmt(b0, p.t0.decimals)} ${p.t0.symbol} · ${fmt(b1, p.t1.decimals)} ${p.t1.symbol}`)
    $('#do').onclick = async () => {
      const me = need(); const plan = L.addPlan(p, parseUnits(i0.value || '0', p.t0.decimals), parseUnits(i1.value || '0', p.t1.decimals), slip, me)
      if (plan.L === 0n) return toast('Enter an amount')
      await ensureApprovals(p.t0, plan.max0); await ensureApprovals(p.t1, plan.max1)
      await sendTx(L.PM, plan.data, plan.value, 'Add liquidity'); refresh(p)
    }
  } else if (t === 'Transfer') {
    act.innerHTML = `<label class="muted">Send position NFT #${p.tokenId} to</label><input id="to" placeholder="0x…"><div class="muted">Moves ownership of the whole position (liquidity + fees). Double-check the address.</div><button class="b" id="do" style="width:100%;margin-top:10px">Transfer position</button>`
    $('#do').onclick = async () => { const me = need(); const to = ($('#to') as HTMLInputElement).value.trim(); if (!isAddress(to)) return toast('Bad address'); if (!confirm(`Transfer #${p.tokenId} to ${to}?`)) return; await sendTx(L.PM, L.transferNftCalldata(me, getAddress(to), p.tokenId), 0n, 'Transfer NFT') }
  } else {
    const opts = [p.t0, p.t1].filter(x => !x.native)
    act.innerHTML = `<label class="muted">Token</label><select id="tk">${opts.map((x, i) => `<option value="${i}">${esc(x.symbol)}</option>`).join('')}</select>
     <label class="muted">To</label><input id="to" placeholder="0x…"><label class="muted">Amount</label><input id="amt" inputmode="decimal" placeholder="0.0"><button class="b" id="do" style="width:100%;margin-top:10px">Send token</button>`
    $('#do').onclick = async () => { need(); const tk = opts[Number(($('#tk') as HTMLSelectElement).value)]; const to = ($('#to') as HTMLInputElement).value.trim(); if (!isAddress(to)) return toast('Bad address'); const amt = parseUnits(($('#amt') as HTMLInputElement).value || '0', tk.decimals); if (amt === 0n) return toast('Enter amount'); if (!confirm(`Send ${formatUnits(amt, tk.decimals)} ${tk.symbol} to ${to}?`)) return; await sendTx(tk.address, L.erc20TransferCalldata(getAddress(to), amt), 0n, `Send ${tk.symbol}`) }
  }
}

shell(); setBtn()
const q = new URLSearchParams(location.search).get('addr')
if (q && isAddress(q)) { viewAddr = getAddress(q); (document.getElementById('addr') as HTMLInputElement).value = viewAddr; load(viewAddr) }
const qid = new URLSearchParams(location.search).get('id')
if (qid && /^\d+$/.test(qid)) L.loadPosition(BigInt(qid)).then(p => { positions.set(qid, p); openDetail(p) }).catch(() => toast('Position not found'))
