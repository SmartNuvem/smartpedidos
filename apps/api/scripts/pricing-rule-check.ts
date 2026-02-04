import { calculatePricing } from "../src/pricingRule";

const assertEqual = (label: string, actual: number, expected: number) => {
  if (actual !== expected) {
    throw new Error(`${label} esperado ${expected}, recebeu ${actual}`);
  }
};

const sumResult = calculatePricing({
  pricingRule: "SUM",
  basePriceCents: 1000,
  groups: [
    {
      groupName: "Extras",
      items: [{ priceDeltaCents: 200 }, { priceDeltaCents: 300 }],
    },
  ],
});
assertEqual("SUM com complementos", sumResult.unitPriceCents, 1500);

const pizzaResult = calculatePricing({
  pricingRule: "MAX_OPTION",
  basePriceCents: 0,
  groups: [
    {
      groupName: "Sabores",
      items: [{ priceDeltaCents: 1200 }, { priceDeltaCents: 1500 }],
    },
    {
      groupName: "Borda",
      items: [{ priceDeltaCents: 200 }],
    },
  ],
});
assertEqual("MAX_OPTION com 2 sabores + borda", pizzaResult.unitPriceCents, 1700);

const pizzaSingleFlavor = calculatePricing({
  pricingRule: "MAX_OPTION",
  basePriceCents: 0,
  groups: [
    {
      groupName: "Sabores",
      items: [{ priceDeltaCents: 1200 }],
    },
  ],
});
assertEqual("MAX_OPTION com 1 sabor", pizzaSingleFlavor.unitPriceCents, 1200);

const pizzaMissingFlavor = calculatePricing({
  pricingRule: "MAX_OPTION",
  basePriceCents: 0,
  groups: [
    {
      groupName: "Extras",
      items: [{ priceDeltaCents: 200 }],
    },
  ],
});
if (pizzaMissingFlavor.hasFlavorSelection) {
  throw new Error("MAX_OPTION sem sabores deveria ser inválido.");
}

console.log("pricing-rule-check ok");
