declare module 'jstat' {
  export const jStat: {
    normal: { cdf(value: number, mean: number, standardDeviation: number): number };
    studentt: { cdf(value: number, degreesOfFreedom: number): number };
  };
}