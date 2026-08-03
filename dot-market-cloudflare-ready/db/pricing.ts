export type PricingConfig = {
  tilePrice: number;
  deadlineMultipliers: Record<string, number>;
};

export const DEFAULT_PRICING: PricingConfig = {
  tilePrice: 2000,
  deadlineMultipliers: {
    "1": 1.55,
    // Everything that is not the rush option is the base price.
    "2": 1,
    "3": 1,
    "4": 1,
    "5": 1,
    "6": 1,
    "7": 1,
  },
};
