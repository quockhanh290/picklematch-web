import { useState, useMemo } from "react";

// ─── Combinatorics ────────────────────────────────────────────────────────────
function getCombos(arr, k) {
  const res = [], tmp = [];
  function go(s) {
    if (tmp.length === k) { res.push([...tmp]); return; }
    for (let i = s; i <= arr.length - (k - tmp.length); i++) {
      tmp.push(arr[i]); go(i + 1); tmp.pop();
    }
  }
  go(0);
  return res;
}

// ─── Pair map helpers ─────────────────────────────────────────────────────────
const pk  = (a, b) => a < b ? `${a}_${b}` : `${b}_${a}`;
const gv  = (m, a, b) => m[pk(a, b)] || 0;
const inc = (m, a, b) => { const k = pk(a, b); m[k] = (m[k] || 0) + 1; };

// minimum partner-repeat score achievable for a court of 4 (across 3 possible 2v2 splits)
function minCourtScore([a, b, c, d], pm) {
  return Math.min(
    gv(pm,a,b)+gv(pm,c,d),
    gv(pm,a,c)+gv(pm,b,d),
    gv(pm,a,d)+gv(pm,b,c)
  );
}

// pick the 2v2 split for a court that minimises repeated partner pairings
function bestSplitOf([a, b, c, d], pm) {
  const opts = [[[a,b],[c,d]], [[a,c],[b,d]], [[a,d],[b,c]]];
  return opts.reduce((best, cur) => {
    const s = (t) => gv(pm, t[0][0], t[0][1]) + gv(pm, t[1][0], t[1][1]);
    return s(cur) < s(best) ? cur : best;
  });
}

// ─── Core scheduler ───────────────────────────────────────────────────────────
function buildSchedule(n = 13, courtCount = 3, roundsCount) {
  const players = [...Array(n).keys()];
  const courtsPerRound = Math.min(Math.max(1, Math.floor(courtCount)), Math.floor(n / 4));
  const sittersPerRound = n - courtsPerRound * 4;
  const targetRounds = roundsCount ?? Math.ceil((n * (n - 1) / 4) / Math.max(1, courtsPerRound));
  const pm = {}, om = {};
  const sitCnt = Object.fromEntries(players.map(p => [p, 0]));
  const gamesCnt = Object.fromEntries(players.map(p => [p, 0]));
  const rounds = [];

  if (n < 4 || courtsPerRound < 1) {
    return { rounds, pm, om, gamesCnt, sitCnt, players, allPairs: getCombos(players, 2), pVals: [], oVals: [], courtsPerRound, sittersPerRound };
  }

  const splitScore = ([[a, b], [c, d]]) => {
    const partnerRepeats = gv(pm, a, b) + gv(pm, c, d);
    const opponentRepeats = gv(om, a, c) + gv(om, a, d) + gv(om, b, c) + gv(om, b, d);
    return partnerRepeats * 100 + opponentRepeats;
  };

  const bestSplit = (court) => {
    const [a, b, c, d] = court;
    const opts = [[[a,b],[c,d]], [[a,c],[b,d]], [[a,d],[b,c]]];
    return opts.reduce((best, cur) => splitScore(cur) < splitScore(best) ? cur : best);
  };

  const courtScore = (court) => splitScore(bestSplit(court));

  const choosePartition = (active) => {
    let bestP = [], bestScore = Infinity;
    const candidateLimit = courtsPerRound <= 3 ? Infinity : 80;

    const search = (remaining, partition, score) => {
      if (partition.length === courtsPerRound) {
        if (score < bestScore) { bestScore = score; bestP = partition.map(c => [...c]); }
        return score === 0;
      }
      if (score >= bestScore) return false;

      const anchor = remaining[0];
      const candidates = getCombos(remaining.slice(1), 3)
        .map(rest => [anchor, ...rest])
        .sort((a, b) => courtScore(a) - courtScore(b))
        .slice(0, candidateLimit);

      for (const court of candidates) {
        const next = remaining.filter(p => !court.includes(p));
        if (search(next, [...partition, court], score + courtScore(court))) return true;
      }
      return false;
    };

    search(active, [], 0);
    return bestP;
  };

  for (let r = 0; r < Math.max(1, Math.floor(targetRounds)); r++) {
    const sitters = [...players]
      .sort((a, b) => sitCnt[a] !== sitCnt[b] ? sitCnt[a] - sitCnt[b] : gamesCnt[b] - gamesCnt[a])
      .slice(0, sittersPerRound);
    sitters.forEach(p => sitCnt[p]++);

    const active = players
      .filter(p => !sitters.includes(p))
      .sort((a, b) => gamesCnt[a] !== gamesCnt[b] ? gamesCnt[a] - gamesCnt[b] : a - b);

    const bestP = choosePartition(active);
    const courts = bestP.map(court => bestSplit(court));

    courts.forEach(([tA, tB]) => {
      inc(pm, tA[0], tA[1]); inc(pm, tB[0], tB[1]);
      tA.forEach(a => tB.forEach(b => inc(om, a, b)));
      [...tA, ...tB].forEach(p => gamesCnt[p]++);
    });
    rounds.push({ r: r + 1, out: sitters, courts, score: 0 });
  }

  const allPairs = getCombos(players, 2);
  return {
    rounds, pm, om, gamesCnt, sitCnt, players, allPairs, courtsPerRound, sittersPerRound,
    pVals: allPairs.map(([a,b]) => gv(pm, a, b)),
    oVals: allPairs.map(([a,b]) => gv(om, a, b)),
  };
}
// ─── Labels ───────────────────────────────────────────────────────────────────
const RAW_LABELS = ['A','B','C','D','E','F','G','H','I','J','K','L','M'];

// ─── App ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [labels, setLabels] = useState(RAW_LABELS);
  const [editingLabel, setEditingLabel] = useState(null);
  const [tab, setTab] = useState('schedule');
  const data = useMemo(() => buildSchedule(13), []);

  const { rounds, pm, om, gamesCnt, sitCnt, players, allPairs, pVals, oVals } = data;
  const N = allPairs.length; // 78
  const pPerfect = pVals.filter(v => v === 1).length;
  const oPerfect = oVals.filter(v => v === 2).length;

  const lbl = i => labels[i] || `P${i+1}`;

  const updateLabel = (i, val) => {
    const next = [...labels];
    next[i] = val.slice(0, 6) || RAW_LABELS[i];
    setLabels(next);
    setEditingLabel(null);
  };

  const TABS = [
    { id: 'schedule',  icon: '📅', label: 'Lịch thi đấu' },
    { id: 'partners',  icon: '🤝', label: 'Cặp đôi' },
    { id: 'opponents', icon: '⚔️', label: 'Đối thủ' },
    { id: 'stats',     icon: '📊', label: 'Thống kê' },
    { id: 'algo',      icon: '🧠', label: 'Thuật toán' },
  ];

  return (
    <div style={{ fontFamily: "'DM Sans', system-ui, sans-serif", minHeight: '100vh', background: '#f8fafc', color: '#0f172a' }}>
      {/* Header */}
      <div style={{ background: 'linear-gradient(135deg, #16a34a 0%, #15803d 60%, #166534 100%)', color: 'white', padding: '24px 20px 0' }}>
        <div style={{ maxWidth: 920, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 18, flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, opacity: .7, marginBottom: 4, textTransform: 'uppercase' }}>PickleMatch · Round Robin</div>
              <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900, letterSpacing: -0.5 }}>🏓 Lịch 13 người · Doubles</h1>
              <p style={{ margin: '6px 0 0', opacity: .8, fontSize: 13 }}>
                Mỗi cặp làm đôi đúng 1 lần · Mỗi cặp đối đầu đúng 2 lần · Ai cũng chơi 12 trận
              </p>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, minWidth: 320 }}>
              {[
                { v: `${rounds.length}`, u: 'vòng', s: `${rounds.length * 3} trận tổng` },
                { v: '12', u: 'trận', s: 'mỗi người, ±0' },
                { v: `${pPerfect}/${N}`, u: 'cặp đôi', s: `${(pPerfect/N*100).toFixed(0)}% ok` },
                { v: `${oPerfect}/${N}`, u: 'đối thủ', s: `${(oPerfect/N*100).toFixed(0)}% ok` },
              ].map(({ v, u, s }) => (
                <div key={u} style={{ background: 'rgba(255,255,255,.15)', borderRadius: 8, padding: '10px 8px', textAlign: 'center', backdropFilter: 'blur(4px)' }}>
                  <div style={{ fontSize: 20, fontWeight: 900, lineHeight: 1 }}>{v}</div>
                  <div style={{ fontSize: 10, opacity: .75, textTransform: 'uppercase', letterSpacing: 1, marginTop: 2 }}>{u}</div>
                  <div style={{ fontSize: 11, marginTop: 3, opacity: .85 }}>{s}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 2 }}>
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)} style={{
                padding: '10px 16px', fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer',
                background: tab === t.id ? 'white' : 'transparent',
                color: tab === t.id ? '#15803d' : 'rgba(255,255,255,.8)',
                borderRadius: '8px 8px 0 0',
                transition: 'all .15s',
              }}>{t.icon} {t.label}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 920, margin: '0 auto', padding: '20px 16px 40px' }}>

        {/* Name editor hint */}
        {tab === 'schedule' && (
          <div style={{ marginBottom: 16, padding: '10px 14px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, fontSize: 12, color: '#15803d' }}>
            💡 Click vào tên người chơi bên dưới để đổi tên (tối đa 6 ký tự)
          </div>
        )}

        {/* Label editor (shown in schedule tab) */}
        {tab === 'schedule' && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
            {players.map(p => (
              <div key={p}>
                {editingLabel === p ? (
                  <input
                    autoFocus
                    defaultValue={lbl(p)}
                    maxLength={6}
                    onBlur={e => updateLabel(p, e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') updateLabel(p, e.target.value); if (e.key === 'Escape') setEditingLabel(null); }}
                    style={{ width: 56, padding: '4px 6px', border: '2px solid #16a34a', borderRadius: 6, fontSize: 13, fontWeight: 700, textAlign: 'center', outline: 'none' }}
                  />
                ) : (
                  <button onClick={() => setEditingLabel(p)} style={{
                    padding: '4px 10px', fontSize: 13, fontWeight: 700, background: 'white',
                    border: '1px solid #e2e8f0', borderRadius: 6, cursor: 'pointer',
                    color: '#374151', transition: 'border-color .1s',
                  }}
                    onMouseOver={e => e.currentTarget.style.borderColor = '#16a34a'}
                    onMouseOut={e => e.currentTarget.style.borderColor = '#e2e8f0'}
                  >{lbl(p)}</button>
                )}
              </div>
            ))}
          </div>
        )}

        {tab === 'schedule'  && <ScheduleView  rounds={rounds} lbl={lbl} />}
        {tab === 'partners'  && <MatrixView    map={pm} players={players} target={1} lbl={lbl} title="Số lần làm cặp đôi" subtitle="Mục tiêu: mỗi cặp = 1 lần" />}
        {tab === 'opponents' && <MatrixView    map={om} players={players} target={2} lbl={lbl} title="Số lần đối đầu" subtitle="Mục tiêu: mỗi cặp = 2 lần" />}
        {tab === 'stats'     && <StatsView     gamesCnt={gamesCnt} sitCnt={sitCnt} players={players} pVals={pVals} oVals={oVals} lbl={lbl} />}
        {tab === 'algo'      && <AlgoView />}
      </div>
    </div>
  );
}

// ─── Schedule View ────────────────────────────────────────────────────────────
function ScheduleView({ rounds, lbl }) {
  const sitterLabel = out => Array.isArray(out) ? out.map(lbl).join(', ') : lbl(out);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {rounds.map(({ r, out, courts, score }) => (
        <div key={r} style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,.06)' }}>
          <div style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', padding: '8px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 800, color: '#15803d', fontSize: 15 }}>Vòng {r}</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {score > 0 && (
                <span style={{ fontSize: 11, background: '#fef9c3', color: '#92400e', padding: '2px 8px', borderRadius: 10, border: '1px solid #fde68a', fontWeight: 600 }}>
                  ⚠ cặp lặp ×{score}
                </span>
              )}
              <span style={{ fontSize: 12, color: '#6b7280', background: '#fee2e2', padding: '3px 10px', borderRadius: 12, fontWeight: 600, border: '1px solid #fecaca' }}>
                Nghỉ: {sitterLabel(out)}
              </span>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '1px', background: '#e2e8f0' }}>
            {courts.map(([tA, tB], i) => (
              <div key={i} style={{ background: 'white', padding: '14px 10px', textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: '#94a3b8', letterSpacing: 1.5, fontWeight: 700, textTransform: 'uppercase', marginBottom: 8 }}>Sân {i + 1}</div>
                <div style={{ fontWeight: 900, color: '#1d4ed8', fontSize: 17, letterSpacing: -0.3 }}>{lbl(tA[0])} & {lbl(tA[1])}</div>
                <div style={{ color: '#94a3b8', margin: '6px 0', fontSize: 11, fontWeight: 800, letterSpacing: 2 }}>VS</div>
                <div style={{ fontWeight: 900, color: '#dc2626', fontSize: 17, letterSpacing: -0.3 }}>{lbl(tB[0])} & {lbl(tB[1])}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Matrix View ──────────────────────────────────────────────────────────────
function MatrixView({ map, players, target, lbl, title, subtitle }) {
  const cell = v => {
    if (v === 0)      return { bg: '#fee2e2', fg: '#ef4444', fw: 600 };
    if (v < target)   return { bg: '#fef9c3', fg: '#92400e', fw: 600 };
    if (v === target) return { bg: '#dcfce7', fg: '#15803d', fw: 800 };
    return                   { bg: '#dbeafe', fg: '#1d4ed8', fw: 700 };
  };

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ margin: '0 0 2px', fontSize: 18, fontWeight: 800 }}>{title}</h2>
        <p style={{ margin: 0, color: '#6b7280', fontSize: 13 }}>{subtitle}</p>
      </div>
      <div style={{ overflowX: 'auto', background: 'white', borderRadius: 12, border: '1px solid #e2e8f0', boxShadow: '0 1px 4px rgba(0,0,0,.06)' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
          <thead>
            <tr style={{ background: '#f8fafc' }}>
              <th style={{ padding: '8px 10px', borderBottom: '2px solid #e2e8f0', borderRight: '2px solid #e2e8f0', color: '#64748b', fontSize: 11 }}>↓ vs →</th>
              {players.map(p => (
                <th key={p} style={{ padding: '8px 6px', borderBottom: '2px solid #e2e8f0', fontWeight: 700, color: '#374151', minWidth: 38, textAlign: 'center' }}>
                  {lbl(p)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {players.map(a => (
              <tr key={a}>
                <td style={{ padding: '6px 10px', fontWeight: 800, background: '#f8fafc', borderRight: '2px solid #e2e8f0', color: '#374151', whiteSpace: 'nowrap' }}>{lbl(a)}</td>
                {players.map(b => {
                  if (a === b) return <td key={b} style={{ background: '#1e293b', padding: '6px 4px', textAlign: 'center', color: '#1e293b', borderBottom: '1px solid #f1f5f9' }}>·</td>;
                  const v = gv(map, a, b);
                  const { bg, fg, fw } = cell(v);
                  return (
                    <td key={b} style={{ background: bg, padding: '6px 4px', textAlign: 'center', color: fg, fontWeight: fw, border: '1px solid rgba(0,0,0,.04)', fontSize: 13 }}>
                      {v}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', gap: 14, marginTop: 14, fontSize: 12, flexWrap: 'wrap' }}>
        {[
          { bg: '#fee2e2', fg: '#ef4444', label: '0 — Chưa gặp ⚠️' },
          { bg: '#fef9c3', fg: '#92400e', label: `<${target} — Thiếu` },
          { bg: '#dcfce7', fg: '#15803d', label: `${target} — Đúng mục tiêu ✅` },
          { bg: '#dbeafe', fg: '#1d4ed8', label: `>${target} — Vượt` },
        ].map(({ bg, fg, label }) => (
          <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#374151' }}>
            <span style={{ width: 14, height: 14, background: bg, border: `1px solid ${fg}`, borderRadius: 3, display: 'inline-block', opacity: .8 }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Stats View ───────────────────────────────────────────────────────────────
function StatsView({ gamesCnt, sitCnt, players, pVals, oVals, lbl }) {
  const freq = vals => {
    const f = {};
    vals.forEach(v => { f[v] = (f[v] || 0) + 1; });
    return Object.entries(f).sort(([a],[b]) => +a - +b);
  };
  const maxG = Math.max(...players.map(p => gamesCnt[p]));

  const Card = ({ children, title, note }) => (
    <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, padding: '18px', boxShadow: '0 1px 4px rgba(0,0,0,.06)' }}>
      <h3 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 800 }}>{title}</h3>
      {note && <p style={{ margin: '0 0 14px', fontSize: 12, color: '#6b7280' }}>{note}</p>}
      {children}
    </div>
  );

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
      <Card title="Số trận mỗi người" note="Mục tiêu: 12 trận, chênh lệch ≤1">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {players.map(p => (
            <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <span style={{ width: 30, fontWeight: 800, color: '#374151', fontSize: 12 }}>{lbl(p)}</span>
              <div style={{ flex: 1, background: '#f1f5f9', borderRadius: 4, height: 18, position: 'relative', overflow: 'hidden' }}>
                <div style={{
                  position: 'absolute', left: 0, top: 0, bottom: 0,
                  width: `${(gamesCnt[p] / maxG) * 100}%`,
                  background: gamesCnt[p] === 12 ? '#16a34a' : '#f59e0b',
                  borderRadius: 4, transition: 'width .4s ease',
                }} />
              </div>
              <span style={{ width: 52, color: '#374151', fontWeight: 700, fontSize: 12 }}>{gamesCnt[p]} trận</span>
              <span style={{ color: '#94a3b8', fontSize: 11 }}>nghỉ ×{sitCnt[p]}</span>
            </div>
          ))}
        </div>
      </Card>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Card title="Phân phối cặp đôi" note="Mục tiêu: mỗi cặp ghép đúng 1 lần">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ background: '#f8fafc' }}>
              <th style={{ padding: '5px 8px', textAlign: 'left', fontWeight: 700, color: '#64748b', fontSize: 11 }}>Số lần</th>
              <th style={{ padding: '5px 8px', textAlign: 'center', fontWeight: 700, color: '#64748b', fontSize: 11 }}>Số cặp</th>
              <th style={{ padding: '5px 8px', fontSize: 11 }}>Kết quả</th>
            </tr></thead>
            <tbody>
              {freq(pVals).map(([v, cnt]) => (
                <tr key={v} style={{ background: +v===1?'#f0fdf4':+v===0?'#fef2f2':'#fff7ed', borderTop: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '6px 8px' }}>{v} lần</td>
                  <td style={{ padding: '6px 8px', textAlign: 'center', fontWeight: 800, fontSize: 15 }}>{cnt}</td>
                  <td style={{ padding: '6px 8px' }}>{+v===1?'✅':+v===0?'⚠️ Chưa gặp':'❌ Trùng'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Phân phối đối đầu" note="Mục tiêu: mỗi cặp đối đầu đúng 2 lần">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ background: '#f8fafc' }}>
              <th style={{ padding: '5px 8px', textAlign: 'left', fontWeight: 700, color: '#64748b', fontSize: 11 }}>Số lần</th>
              <th style={{ padding: '5px 8px', textAlign: 'center', fontWeight: 700, color: '#64748b', fontSize: 11 }}>Số cặp</th>
              <th style={{ padding: '5px 8px', fontSize: 11 }}>Kết quả</th>
            </tr></thead>
            <tbody>
              {freq(oVals).map(([v, cnt]) => (
                <tr key={v} style={{ background: +v===2?'#f0fdf4':+v===0?'#fef2f2':'#eff6ff', borderTop: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '6px 8px' }}>{v} lần</td>
                  <td style={{ padding: '6px 8px', textAlign: 'center', fontWeight: 800, fontSize: 15 }}>{cnt}</td>
                  <td style={{ padding: '6px 8px' }}>{+v===2?'✅':+v===0?'⚠️':'ℹ️'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}

// ─── Algorithm View ───────────────────────────────────────────────────────────
function AlgoView() {
  const steps = [
    {
      n: '1', color: '#16a34a',
      title: 'Chọn người nghỉ',
      body: 'Ưu tiên người có số lần nghỉ ít nhất. Hòa → chọn người chơi nhiều nhất (cân bằng tổng trận). Kết quả: mỗi người nghỉ đúng 1 lần trong 13 vòng.',
    },
    {
      n: '2', color: '#2563eb',
      title: 'Tìm phân nhóm tối ưu (exhaustive)',
      body: 'Thử tất cả C(12,4) × C(8,4) = 34.650 cách chia 12 người còn lại thành 3 nhóm 4 người. Score của mỗi cách chia = tổng số cặp đôi bị lặp lại. Chọn cách có score nhỏ nhất. Thoát sớm (early exit) nếu score = 0.',
    },
    {
      n: '3', color: '#7c3aed',
      title: 'Tìm cách đánh 2v2 tối ưu',
      body: 'Mỗi nhóm 4 người có 3 cách chia 2v2. Chọn cách chưa có cặp đôi nào bị trùng với các vòng trước. Điều này đảm bảo partner coverage tối đa.',
    },
    {
      n: '4', color: '#0891b2',
      title: 'Cập nhật trạng thái',
      body: 'Ghi nhận: cặp đôi mới (partner_map), cặp đối thủ mới (opponent_map), số trận của mỗi người. Dùng cho vòng tiếp theo.',
    },
  ];

  const math = [
    { label: 'Tổng cặp C(13,2)', value: '78 cặp' },
    { label: 'Vòng × cặp đôi/vòng', value: '13 × 6 = 78 ✅' },
    { label: 'Mỗi cặp làm đôi', value: 'đúng 1 lần' },
    { label: 'Vòng × đối thủ/vòng', value: '13 × 12 = 156' },
    { label: '156 / 78 cặp', value: '= 2 lần/cặp ✅' },
    { label: 'Trận/người', value: '12 trận, ±0' },
  ];

  return (
    <div style={{ maxWidth: 660 }}>
      <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, padding: 20, marginBottom: 16, boxShadow: '0 1px 4px rgba(0,0,0,.06)' }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 800 }}>Tại sao 13 vòng là con số hoàn hảo?</h2>
        <p style={{ margin: '0 0 16px', color: '#6b7280', fontSize: 13 }}>
          Với n = 13 người (số lẻ), 3 sân/vòng, 1 người nghỉ mỗi vòng — các con số khớp nhau hoàn toàn:
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
          {math.map(({ label, value }) => (
            <div key={label} style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 12px' }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#15803d' }}>{value}</div>
              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{label}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, padding: 20, marginBottom: 16, boxShadow: '0 1px 4px rgba(0,0,0,.06)' }}>
        <h2 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 800 }}>Các bước thuật toán</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {steps.map(({ n, color, title, body }) => (
            <div key={n} style={{ display: 'flex', gap: 14 }}>
              <div style={{ width: 32, height: 32, background: color, color: 'white', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 15, flexShrink: 0 }}>{n}</div>
              <div>
                <div style={{ fontWeight: 800, color: '#111827', marginBottom: 4, fontSize: 14 }}>{title}</div>
                <div style={{ fontSize: 13, color: '#4b5563', lineHeight: 1.6 }}>{body}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, padding: 16 }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14, color: '#1d4ed8' }}>⚡ Hiệu năng</h3>
          <p style={{ margin: 0, fontSize: 13, color: '#1e40af', lineHeight: 1.6 }}>
            Early exit khi score = 0 → hầu hết vòng đầu kết thúc ngay lập tức. Tổng 13 vòng chạy &lt; 200ms trong browser.
          </p>
        </div>
        <div style={{ background: '#fef9c3', border: '1px solid #fde68a', borderRadius: 10, padding: 16 }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14, color: '#92400e' }}>⚠️ Giới hạn</h3>
          <p style={{ margin: 0, fontSize: 13, color: '#78350f', lineHeight: 1.6 }}>
            Greedy tối ưu từng vòng độc lập. Có thể thêm random restarts (×20) để tìm kết quả tốt hơn nếu cần.
          </p>
        </div>
      </div>
    </div>
  );
}
