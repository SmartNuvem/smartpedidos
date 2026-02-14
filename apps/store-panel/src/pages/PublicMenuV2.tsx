import React from "react";

type Product = {
  id: string | number;
  name: string;
  composition?: string;
  priceCents: number;
  optionGroups?: unknown[];
  imageUrl?: string;
  isPromo?: boolean;
  isOnSale?: boolean;
  isNew?: boolean;
  isFeatured?: boolean;
};

type Category = {
  id: string | number;
  name: string;
  products: Product[];
};

type Props = {
  sortedCategories: Category[];
  activeCategoryId: string | number | null;
  categoryTabRefs: React.MutableRefObject<Record<string, HTMLButtonElement>>;
  categoryHeadingRefs: React.MutableRefObject<Record<string, HTMLElement>>;
  stickyRef: React.MutableRefObject<HTMLDivElement | null>;
  scrollToCategory: (categoryId: string | number) => void;
  handleAddProduct: (product: Product) => void;
  formatCurrency: (value: number) => string;
};

const cn = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(" ");

export default function PublicMenuV2({
  sortedCategories,
  activeCategoryId,
  categoryTabRefs,
  categoryHeadingRefs,
  stickyRef,
  scrollToCategory,
  handleAddProduct,
  formatCurrency,
}: Props) {
  return (
    <section className="space-y-6">
      <div
        ref={stickyRef}
        className="sticky top-2 z-20 -mx-2 overflow-x-auto rounded-xl bg-white/95 px-2 py-2 shadow-sm backdrop-blur"
      >
        <div className="flex w-max gap-2">
          {sortedCategories.map((category) => (
            <button
              key={`tab-${category.id}`}
              type="button"
              ref={(node) => {
                if (node) {
                  categoryTabRefs.current[category.id] = node;
                } else {
                  delete categoryTabRefs.current[category.id];
                }
              }}
              className={`rounded-full border px-4 py-2 text-xs font-semibold transition-colors duration-150 ease-out motion-reduce:transition-none ${
                activeCategoryId === category.id
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-100"
              }`}
              onClick={() => scrollToCategory(category.id)}
            >
              {category.name}
            </button>
          ))}
        </div>
      </div>

      {sortedCategories.map((category) => (
        <div
          id={`category-${category.id}`}
          key={category.id}
          data-category-id={category.id}
          className="space-y-3 scroll-mt-[120px] sm:scroll-mt-[140px]"
        >
          <h2
            id={`cat-${category.id}`}
            ref={(node) => {
              if (node) {
                categoryHeadingRefs.current[category.id] = node;
              } else {
                delete categoryHeadingRefs.current[category.id];
              }
            }}
            className="text-lg font-semibold text-slate-900"
          >
            {category.name}
          </h2>
          <div className="grid gap-3">
            {category.products.map((product) => {
              const isPromo = Boolean(product.isPromo);
              const isOnSale = Boolean(product.isOnSale);
              const isNew = Boolean(product.isNew);

              return (
                <div
                  key={product.id}
                  className={cn(
                    "relative min-h-[96px] overflow-hidden rounded-xl bg-white shadow-sm transition-transform transition-shadow duration-150 ease-out hover:-translate-y-[1px] hover:shadow-md active:-translate-y-[1px] active:shadow-md motion-reduce:transform-none motion-reduce:transition-none sm:min-h-[128px]",
                    isPromo && "border-2 border-amber-400 bg-amber-50 shadow-lg shadow-amber-100"
                  )}
                >
                  {isPromo ? (
                    <div
                      className="absolute left-0 top-0 h-full w-1.5 rounded-l-xl bg-gradient-to-b from-amber-400 to-amber-500"
                      aria-hidden="true"
                    />
                  ) : null}
                  <div className="relative z-10 flex items-stretch">
                    <div className="flex w-28 flex-shrink-0 self-stretch overflow-hidden rounded-l-xl sm:w-32">
                      {product.imageUrl ? (
                        <img
                          src={product.imageUrl}
                          alt={product.name}
                          loading="lazy"
                          className="h-full min-h-[96px] w-full object-cover sm:min-h-[128px]"
                        />
                      ) : (
                        <div className="flex h-full min-h-[96px] w-full items-center justify-center bg-gray-100 text-xs text-gray-400 sm:min-h-[128px]">
                          Sem foto
                        </div>
                      )}
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col justify-between p-3 sm:p-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className="truncate font-semibold leading-tight text-slate-900">{product.name}</p>
                          {isPromo ? (
                            <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800">
                              Promoção do dia
                            </span>
                          ) : null}
                          {product.isFeatured ? (
                            <span className="whitespace-nowrap rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold">
                              Mais pedido
                            </span>
                          ) : null}
                          {isNew ? (
                            <span className="whitespace-nowrap rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold">
                              Novo
                            </span>
                          ) : null}
                          {isOnSale ? (
                            <span className="whitespace-nowrap rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold">
                              Oferta
                            </span>
                          ) : null}
                        </div>
                        {product.composition?.trim() ? (
                          <p className="mt-1 line-clamp-1 text-xs text-slate-500 sm:line-clamp-2">{product.composition}</p>
                        ) : null}
                        <p className="mt-1 text-sm leading-tight text-slate-500">{formatCurrency(product.priceCents / 100)}</p>
                      </div>
                      <div className="mt-2 flex justify-end">
                        <button
                          className="shrink-0 self-center rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-transform transition-colors duration-150 ease-out hover:bg-blue-700 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 focus-visible:ring-offset-2 motion-reduce:transform-none motion-reduce:transition-none sm:px-6 sm:py-3 sm:text-base"
                          onClick={() => handleAddProduct(product)}
                        >
                          {product.optionGroups && product.optionGroups.length > 0 ? "Personalizar" : "Adicionar"}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}
