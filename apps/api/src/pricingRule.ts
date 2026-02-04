export type PricingRule = "SUM" | "MAX_OPTION";

export type SelectedOptionGroup = {
  groupName: string;
  items: Array<{ priceDeltaCents: number }>;
};

export type PricingCalculationResult = {
  unitPriceCents: number;
  baseFromFlavorsCents: number | null;
  extrasCents: number;
  hasFlavorSelection: boolean;
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
    };
  }

  let baseFromFlavorsCents: number | null = null;
  let extrasCents = 0;
  let hasFlavorSelection = false;

  groups.forEach((group) => {
    if (isFlavorGroupName(group.groupName)) {
      if (group.items.length === 0) {
        return;
      }
      const maxFlavor = Math.max(
        ...group.items.map((item) => item.priceDeltaCents)
      );
      baseFromFlavorsCents =
        baseFromFlavorsCents === null
          ? maxFlavor
          : Math.max(baseFromFlavorsCents, maxFlavor);
      hasFlavorSelection = true;
      return;
    }

    const groupTotal = group.items.reduce(
      (groupSum, item) => groupSum + item.priceDeltaCents,
      0
    );
    extrasCents += groupTotal;
  });

  return {
    unitPriceCents: (baseFromFlavorsCents ?? 0) + extrasCents,
    baseFromFlavorsCents,
    extrasCents,
    hasFlavorSelection,
  };
};
