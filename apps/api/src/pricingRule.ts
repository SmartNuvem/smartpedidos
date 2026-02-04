export type PricingRule = "SUM" | "MAX_OPTION" | "HALF_SUM";

export type SelectedOptionGroup = {
  groupName: string;
  items: Array<{ priceDeltaCents: number }>;
};

export type PricingCalculationResult = {
  unitPriceCents: number;
  baseFromFlavorsCents: number | null;
  extrasCents: number;
  hasFlavorSelection: boolean;
  flavorsCount: number;
};

export const isFlavorGroupName = (name: string) =>
  name.trim().toLowerCase() === "sabores";

export const calculatePricing = ({
  pricingRule,
  basePriceCents,
  groups,
}: {
  pricingRule: PricingRule;
  basePriceCents: number;
  groups: SelectedOptionGroup[];
}): PricingCalculationResult => {
  if (pricingRule === "SUM") {
    const extrasCents = groups.reduce(
      (acc, group) =>
        acc +
        group.items.reduce(
          (groupTotal, item) => groupTotal + item.priceDeltaCents,
          0
        ),
      0
    );
    return {
      unitPriceCents: basePriceCents + extrasCents,
      baseFromFlavorsCents: null,
      extrasCents,
      hasFlavorSelection: true,
      flavorsCount: 0,
    };
  }

  let baseFromFlavorsCents: number | null = null;
  let extrasCents = 0;
  const flavors: number[] = [];

  groups.forEach((group) => {
    if (isFlavorGroupName(group.groupName)) {
      group.items.forEach((item) => {
        flavors.push(item.priceDeltaCents);
      });
      return;
    }

    const groupTotal = group.items.reduce(
      (groupSum, item) => groupSum + item.priceDeltaCents,
      0
    );
    extrasCents += groupTotal;
  });

  const flavorsCount = flavors.length;
  const hasFlavorSelection = flavorsCount > 0;

  if (pricingRule === "MAX_OPTION") {
    if (flavorsCount > 0) {
      baseFromFlavorsCents = Math.max(...flavors);
    }
  }

  if (pricingRule === "HALF_SUM") {
    if (flavorsCount === 1) {
      baseFromFlavorsCents = flavors[0];
    } else if (flavorsCount === 2) {
      baseFromFlavorsCents = Math.floor(
        flavors[0] / 2 + flavors[1] / 2
      );
    }
  }

  return {
    unitPriceCents: (baseFromFlavorsCents ?? 0) + extrasCents,
    baseFromFlavorsCents,
    extrasCents,
    hasFlavorSelection,
    flavorsCount,
  };
};
