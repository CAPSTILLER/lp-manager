import { parseAbi, encodeFunctionData, type Address, type Hex } from 'viem'
import { client } from './lib'

export const VE: Address = '0xeBf418Fe2512e7E6bd9b87a8F0f294aCDC67e6B4'
export const VOTER: Address = '0x16613524e02ad97eDfeF371bC883F2F5d6C480A5'
export const DIST: Address = '0x227f65131A261548b057215bB1D5Ab2997964C7d'
export const AERO: Address = '0x940181a94A35A4569E4529A3CDfB74e38FD98631'
export const RELAY_FACTORIES: Address[] = ['0x825223F246C98A0BA2b05a90701C9Db5810831f2', '0x1c4a5522E293d15168a19baC5319448f58F3dfBA', '0xB953839a8361840f454e7F2A891AD7e13608f2fc', '0xd2823278643ed905FF8477Ef0bB9c89E7B0BA651', '0xD36dAb3bEf6DD077bC4D59098d03fF1053e17397', '0xb805fca66277ACFC45DCBBAC0F770588F2B3a223']
export const DEFAULT_WALLETS: Address[] = ['0xc7d4E906741197aB6D3F6773D93E176596806661', '0xD8382719b8fF90eE3Dd521B9d7c5dc23E8e4EAca']
export const WEEK = 604800

const veAbi = parseAbi(['function balanceOf(address) view returns (uint256)', 'function ownerToNFTokenIdList(address,uint256) view returns (uint256)', 'function ownerOf(uint256) view returns (address)',
  'function locked(uint256) view returns ((int128 amount,uint256 end,bool isPermanent))', 'function balanceOfNFT(uint256) view returns (uint256)', 'function escrowType(uint256) view returns (uint8)',
  'function idToManaged(uint256) view returns (uint256)', 'function weights(uint256,uint256) view returns (uint256)', 'function managedToLocked(uint256) view returns (address)', 'function managedToFree(uint256) view returns (address)'])
const voterAbi = parseAbi(['function lastVoted(uint256) view returns (uint256)', 'function poolVote(uint256,uint256) view returns (address)', 'function votes(uint256,address) view returns (uint256)', 'function usedWeights(uint256) view returns (uint256)',
  'function gauges(address) view returns (address)', 'function gaugeToFees(address) view returns (address)', 'function gaugeToBribe(address) view returns (address)', 'function weights(address) view returns (uint256)', 'function totalWeight() view returns (uint256)',
  'function claimFees(address[] _fees, address[][] _tokens, uint256 _tokenId)', 'function claimBribes(address[] _bribes, address[][] _tokens, uint256 _tokenId)'])
const rwAbi = parseAbi(['function rewardsListLength() view returns (uint256)', 'function rewards(uint256) view returns (address)', 'function earned(address,uint256) view returns (uint256)', 'function tokenRewardsPerEpoch(address,uint256) view returns (uint256)', 'function totalSupply() view returns (uint256)', 'function balanceOf(uint256) view returns (uint256)'])
const distAbi = parseAbi(['function claimable(uint256) view returns (uint256)', 'function claim(uint256) returns (uint256)'])
const relayAbi = parseAbi(['function name() view returns (string)', 'function mTokenId() view returns (uint256)', 'function token() view returns (address)', 'function keeperLastRun() view returns (uint256)'])
const poolAbi = parseAbi(['function symbol() view returns (string)', 'function token0() view returns (address)', 'function token1() view returns (address)', 'function tickSpacing() view returns (int24)'])
const symAbi = parseAbi(['function symbol() view returns (string)'])

const rd = <T = any>(address: Address, abi: any, functionName: string, args: any[] = []) => client.readContract({ address, abi, functionName, args }) as Promise<T>
const safe = <T>(p: Promise<T>, d: T) => p.catch(() => d)

export type Amt = { token: Address; amount: bigint }
export type PoolVote = { pool: Address; name: string; votes: bigint; weightPct: number; poolSharePct: number; fees: Address; bribe: Address; feeEarned: Amt[]; bribeEarned: Amt[]; estNext: Amt[] }
export type Relay = { address: Address; name: string; mTokenId: bigint; token: Address; keeperLastRun: number }
export type Lock = {
  id: bigint; owner: Address; amount: bigint; end: number; permanent: boolean; votingPower: bigint; escrowType: number
  managedId: bigint; managedWeight: bigint; relay: Relay | null; compoundedEarned: Amt[]; freeEarned: Amt[]; managedShare: number
  rebase: bigint; votes: PoolVote[]; lastVoted: number; usedWeight: bigint; epochStart: number; epochEnd: number
}

let relayCache: Relay[] | null = null
export async function relays(): Promise<Relay[]> {
  if (relayCache) return relayCache
  const lists = await Promise.all(RELAY_FACTORIES.map(f => safe(rd<Address[]>(f, parseAbi(['function relays() view returns (address[])']), 'relays'), [] as Address[])))
  const all = lists.flat()
  const res = await client.multicall({ contracts: all.flatMap(a => (['name', 'mTokenId', 'token', 'keeperLastRun'] as const).map(fn => ({ address: a, abi: relayAbi, functionName: fn }))) })
  relayCache = all.map((a, i) => ({ address: a, name: String(res[i * 4].result ?? 'Relay'), mTokenId: (res[i * 4 + 1].result as bigint) ?? 0n, token: (res[i * 4 + 2].result as Address) ?? AERO, keeperLastRun: Number(res[i * 4 + 3].result ?? 0) }))
  return relayCache
}

export async function lockIdsFor(owner: Address): Promise<bigint[]> {
  const n = await rd<bigint>(VE, veAbi, 'balanceOf', [owner])
  return Promise.all([...Array(Number(n))].map((_, i) => rd<bigint>(VE, veAbi, 'ownerToNFTokenIdList', [owner, BigInt(i)])))
}

const symCache = new Map<string, string>()
async function sym(a: Address) { const k = a.toLowerCase(); if (!symCache.has(k)) symCache.set(k, await safe(rd<string>(a, symAbi, 'symbol'), '?')); return symCache.get(k)! }
async function poolName(p: Address) {
  const [t0, t1, ts] = await Promise.all([safe(rd<Address>(p, poolAbi, 'token0'), null as any), safe(rd<Address>(p, poolAbi, 'token1'), null as any), safe(rd<number>(p, poolAbi, 'tickSpacing'), null as any)])
  if (t0 && t1) return `${ts != null ? 'CL' + ts : 'v2'} ${await sym(t0)}/${await sym(t1)}`
  return safe(rd<string>(p, poolAbi, 'symbol'), p.slice(0, 8))
}
async function rewardTokens(r: Address): Promise<Address[]> {
  const n = Number(await safe(rd<bigint>(r, rwAbi, 'rewardsListLength'), 0n))
  return Promise.all([...Array(Math.min(n, 20))].map((_, i) => rd<Address>(r, rwAbi, 'rewards', [BigInt(i)])))
}
async function earnedAll(r: Address, id: bigint, toks: Address[]): Promise<Amt[]> {
  const v = await Promise.all(toks.map(t => safe(rd<bigint>(r, rwAbi, 'earned', [t, id]), 0n)))
  return toks.map((t, i) => ({ token: t, amount: v[i] })).filter(x => x.amount > 0n)
}
// ESTIMATE: share of this epoch's deposited rewards (falls back to last epoch's amount when nothing deposited yet).
async function estNext(r: Address, id: bigint, toks: Address[], epochStart: number): Promise<Amt[]> {
  const [bal, ts] = await Promise.all([safe(rd<bigint>(r, rwAbi, 'balanceOf', [id]), 0n), safe(rd<bigint>(r, rwAbi, 'totalSupply'), 0n)])
  if (!bal || !ts) return []
  const out: Amt[] = []
  for (const t of toks) {
    let cur = await safe(rd<bigint>(r, rwAbi, 'tokenRewardsPerEpoch', [t, BigInt(epochStart)]), 0n)
    if (cur === 0n) cur = await safe(rd<bigint>(r, rwAbi, 'tokenRewardsPerEpoch', [t, BigInt(epochStart - WEEK)]), 0n)
    const a = cur * bal / ts; if (a > 0n) out.push({ token: t, amount: a })
  }
  return out
}

async function votesFor(id: bigint, epochStart: number): Promise<PoolVote[]> {
  const pools: Address[] = []
  for (let i = 0; i < 30; i++) { const p = await safe(rd<Address>(VOTER, voterAbi, 'poolVote', [id, BigInt(i)]), null as any); if (!p) break; pools.push(p) }
  const used = await safe(rd<bigint>(VOTER, voterAbi, 'usedWeights', [id]), 0n)
  return Promise.all(pools.map(async pool => {
    const [votes, gauge, pw, name] = await Promise.all([rd<bigint>(VOTER, voterAbi, 'votes', [id, pool]), rd<Address>(VOTER, voterAbi, 'gauges', [pool]), safe(rd<bigint>(VOTER, voterAbi, 'weights', [pool]), 0n), poolName(pool)])
    const [fees, bribe] = await Promise.all([rd<Address>(VOTER, voterAbi, 'gaugeToFees', [gauge]), rd<Address>(VOTER, voterAbi, 'gaugeToBribe', [gauge])])
    const [ft, bt] = await Promise.all([rewardTokens(fees), rewardTokens(bribe)])
    const [fe, be, e1, e2] = await Promise.all([earnedAll(fees, id, ft), earnedAll(bribe, id, bt), estNext(fees, id, ft, epochStart), estNext(bribe, id, bt, epochStart)])
    return { pool, name, votes, weightPct: used ? Number(votes * 10000n / used) / 100 : 0, poolSharePct: pw ? Number(votes * 1000000n / pw) / 10000 : 0, fees, bribe, feeEarned: fe, bribeEarned: be, estNext: [...e1, ...e2] }
  }))
}

export async function loadLock(id: bigint): Promise<Lock> {
  const now = Math.floor(Date.now() / 1000), epochStart = now - (now % WEEK), epochEnd = epochStart + WEEK
  const [owner, lk, vp, et, mid, rebase, lastVoted, usedWeight] = await Promise.all([
    rd<Address>(VE, veAbi, 'ownerOf', [id]), rd<any>(VE, veAbi, 'locked', [id]), rd<bigint>(VE, veAbi, 'balanceOfNFT', [id]), rd<number>(VE, veAbi, 'escrowType', [id]),
    rd<bigint>(VE, veAbi, 'idToManaged', [id]), safe(rd<bigint>(DIST, distAbi, 'claimable', [id]), 0n), safe(rd<bigint>(VOTER, voterAbi, 'lastVoted', [id]), 0n), safe(rd<bigint>(VOTER, voterAbi, 'usedWeights', [id]), 0n)])
  const L: Lock = { id, owner, amount: BigInt(lk.amount), end: Number(lk.end), permanent: lk.isPermanent, votingPower: vp, escrowType: Number(et), managedId: mid, managedWeight: 0n, relay: null, compoundedEarned: [], freeEarned: [], managedShare: 0, rebase, votes: [], lastVoted: Number(lastVoted), usedWeight, epochStart, epochEnd }
  if (mid > 0n) {
    const [w, lmr, fmr, rl, mlk] = await Promise.all([rd<bigint>(VE, veAbi, 'weights', [id, mid]), rd<Address>(VE, veAbi, 'managedToLocked', [mid]), rd<Address>(VE, veAbi, 'managedToFree', [mid]), relays(), rd<any>(VE, veAbi, 'locked', [mid])])
    L.managedWeight = w; L.relay = rl.find(r => r.mTokenId === mid) || null
    L.managedShare = BigInt(mlk.amount) > 0n ? Number(w * 1000000n / BigInt(mlk.amount)) / 10000 : 0
    const [lt, ft] = await Promise.all([rewardTokens(lmr), rewardTokens(fmr)])
    ;[L.compoundedEarned, L.freeEarned] = await Promise.all([earnedAll(lmr, id, lt.length ? lt : [AERO]), earnedAll(fmr, id, ft)])
    L.votes = await votesFor(mid, epochStart) // the managed veNFT votes on behalf of depositors
  } else L.votes = await votesFor(id, epochStart)
  return L
}

export const claimRebaseCalldata = (id: bigint): Hex => encodeFunctionData({ abi: distAbi, functionName: 'claim', args: [id] })
export function claimFeesBribesCalldata(L: Lock): { fees: Hex | null; bribes: Hex | null } {
  const f = L.votes.filter(v => v.feeEarned.length), b = L.votes.filter(v => v.bribeEarned.length)
  return {
    fees: f.length ? encodeFunctionData({ abi: voterAbi, functionName: 'claimFees', args: [f.map(v => v.fees), f.map(v => v.feeEarned.map(x => x.token)), L.id] }) : null,
    bribes: b.length ? encodeFunctionData({ abi: voterAbi, functionName: 'claimBribes', args: [b.map(v => v.bribe), b.map(v => v.bribeEarned.map(x => x.token)), L.id] }) : null,
  }
}
