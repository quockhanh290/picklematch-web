const players = [
  ['Phan Dũng', 3.71],
  ['Đỗ Thu', 3.53],
  ['Trần Hà', 4.69],
  ['Võ Yến', 2.4],
  ['Hồ Hà', 2.05],
  ['Ngô Long', 4.93],
  ['Võ Thủy', 4.04],
  ['Trần Quỳnh', 2.57],
  ['Trần Việt', 3.46],
  ['Đỗ Thủy', 3.8],
  ['Phan Hà', 4.7],
  ['Võ Hân', 3.19],
] as const;

type Option = {
  match: string;
  pvnaGap: number;
  intraGap: number;
  passesBoth: boolean;
};

const options: Option[] = [];

for (let a = 0; a < players.length; a += 1) {
  for (let b = a + 1; b < players.length; b += 1) {
    for (let c = 0; c < players.length; c += 1) {
      for (let d = c + 1; d < players.length; d += 1) {
        if (new Set([a, b, c, d]).size < 4) continue;

        const teamA = [players[a], players[b]];
        const teamB = [players[c], players[d]];
        const teamASum = teamA[0][1] + teamA[1][1];
        const teamBSum = teamB[0][1] + teamB[1][1];
        const pvnaGap = Math.abs(teamASum - teamBSum);
        const intraGap = Math.max(
          Math.abs(teamA[0][1] - teamA[1][1]),
          Math.abs(teamB[0][1] - teamB[1][1]),
        );

        options.push({
          match: `${teamA[0][0]} + ${teamA[1][0]} vs ${teamB[0][0]} + ${teamB[1][0]}`,
          pvnaGap: Number(pvnaGap.toFixed(2)),
          intraGap: Number(intraGap.toFixed(2)),
          passesBoth: pvnaGap <= 0.5 && intraGap <= 0.75,
        });
      }
    }
  }
}

const unique = new Map<string, Option>();
for (const option of options) {
  const key = option.match.split(' vs ').sort().join(' | ');
  if (!unique.has(key)) unique.set(key, option);
}

const ranked = [...unique.values()].sort(
  (a, b) =>
    Number(b.passesBoth) - Number(a.passesBoth) ||
    a.pvnaGap - b.pvnaGap ||
    a.intraGap - b.intraGap,
);

console.log(JSON.stringify({
  zeroPlayPlayers: players.length,
  passesBothCount: ranked.filter((option) => option.passesBoth).length,
  top20: ranked.slice(0, 20),
}, null, 2));
