const naturalOrder = new Intl.Collator('en-AU', { numeric: true, sensitivity: 'base' });
const sizeOrder = ['XXXS', 'XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', 'XXXXL', 'XXXXXL'];
const sizeAliases: Record<string, string> = { '2XS': 'XXS', '3XS': 'XXXS', '2XL': 'XXL', '3XL': 'XXXL', '4XL': 'XXXXL', '5XL': 'XXXXXL', SMALL: 'S', MEDIUM: 'M', LARGE: 'L' };

export function compareProductVariants(left: { name: string }, right: { name: string }): number {
  const options = (name: string) => name.split(' — ').slice(1).join(' — ') || name;
  const leftOptions = options(left.name);
  const rightOptions = options(right.name);
  const sizeRank = (value: string) => {
    const tokens = value.toUpperCase().split(/[\s/]+/);
    return tokens.map(token => sizeOrder.indexOf(sizeAliases[token] ?? token)).find(rank => rank >= 0) ?? -1;
  };
  const leftRank = sizeRank(leftOptions);
  const rightRank = sizeRank(rightOptions);
  if (leftRank >= 0 && rightRank >= 0 && leftRank !== rightRank) return leftRank - rightRank;
  return naturalOrder.compare(leftOptions, rightOptions);
}