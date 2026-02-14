import React from "react";

type Product = {
  id: string | number;
  name: string;
  composition?: string;
  priceCents: number;
  optionGroups?: unknown[];
  isPromo?: boolean;
};

type Category = {
  id: string | number;
  name: string;
  products: Product[];
};

type Props = {
  sortedCategories: Category[];
  promoProducts: (Product & { categoryName?: string })[];
  handleAddProduct: (product: Product) => void;
  formatCurrency: (value: number) => string;
};

export default function PublicMenuClassic({
  sortedCategories,
  promoProducts,
  handleAddProduct,
  formatCurrency,
}: Props) {
  return (
    <section className="space-y-6">
      {promoProducts.length > 0 ? (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">Promoção do dia</h2>
          <div className="grid gap-3">
            {promoProducts.map((product) => (
              <div key={`promo-${product.id}`} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-slate-900">{product.name}</p>
                    {product.composition?.trim() ? (
                      <p className="line-clamp-2 text-xs text-slate-500">{product.composition}</p>
                    ) : null}
                    <p className="text-sm text-slate-500">{formatCurrency(product.priceCents / 100)}</p>
                  </div>
                  <button
                    className="shrink-0 self-center rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white"
                    onClick={() => handleAddProduct(product)}
                  >
                    {product.optionGroups && product.optionGroups.length > 0 ? "Personalizar" : "Adicionar"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {sortedCategories.map((category) => (
        <div id={`category-${category.id}`} key={category.id} data-category-id={category.id} className="space-y-3">
          <h2 id={`cat-${category.id}`} className="text-lg font-semibold text-slate-900">
            {category.name}
          </h2>
          <div className="grid gap-3">
            {category.products.map((product) => (
              <div key={product.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-slate-900">{product.name}</p>
                      {product.isPromo ? (
                        <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800">
                          Promoção do dia
                        </span>
                      ) : null}
                    </div>
                    {product.composition?.trim() ? (
                      <p className="line-clamp-2 text-xs text-slate-500">{product.composition}</p>
                    ) : null}
                    <p className="text-sm text-slate-500">{formatCurrency(product.priceCents / 100)}</p>
                  </div>
                  <button
                    className="shrink-0 self-center rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white"
                    onClick={() => handleAddProduct(product)}
                  >
                    {product.optionGroups && product.optionGroups.length > 0 ? "Personalizar" : "Adicionar"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
