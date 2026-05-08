export function getEstimatedCostPerPerson(totalCost: number | null | undefined, maxPlayers: number | null | undefined) {
  if (!totalCost || !maxPlayers || maxPlayers <= 0) return 0
  return Math.ceil(totalCost / maxPlayers)
}

export function formatEstimatedCostPerPerson(totalCost: number | null | undefined, maxPlayers: number | null | undefined) {
  const costPerPerson = getEstimatedCostPerPerson(totalCost, maxPlayers)
  if (costPerPerson <= 0) return 'Miễn phí'
  return `${costPerPerson.toLocaleString('vi-VN')}đ/người`
}
