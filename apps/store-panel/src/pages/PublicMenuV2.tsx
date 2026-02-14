import React, { useEffect } from "react";

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
const isProductPromo = (product: Product) => Boolean(product.isPromo);

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
  const normalizeCategoryId = (id: string | number | null | undefined) =>
    id === null || id === undefined ? "" : String(id);

  const scrollPillIntoView = (categoryId: string | number) => {
    if (typeof window === "undefined") return;

    const normalizedCategoryId = normalizeCategoryId(categoryId);
    if (!normalizedCategoryId) return;

    const tab = categoryTabRefs.current[normalizedCategoryId];
    if (!tab) return;

    const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    tab.scrollIntoView({
      behavior: prefersReducedMotion ? "auto" : "smooth",
      inline: "center",
      block: "nearest",
    });
  };

  useEffect(() => {
    if (!activeCategoryId) return;
    scrollPillIntoView(activeCategoryId);
  }, [activeCategoryId]);

  return (
    <section className="public-menu-v2 space-y-6 overflow-visible" data-menu-version="v2">
      <div
        ref={stickyRef}
        className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 py-2 backdrop-blur"
      >
        <div className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex w-max gap-2 px-1">
            {sortedCategories.map((category) => (
              <button
                key={`tab-${category.id}`}
                type="button"
                ref={(node) => {
                  const normalizedCategoryId = normalizeCategoryId(category.id);
                  if (!normalizedCategoryId) return;

                  if (node) {
                    categoryTabRefs.current[normalizedCategoryId] = node;
                  } else {
                    delete categoryTabRefs.current[normalizedCategoryId];
                  }
                }}
                className={`rounded-full border px-4 py-2 text-xs font-semibold transition-colors duration-150 ease-out motion-reduce:transition-none ${
                  normalizeCategoryId(activeCategoryId) === normalizeCategoryId(category.id)
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-100"
                }`}
                onClick={() => {
                  scrollToCategory(category.id);
                  scrollPillIntoView(category.id);
                }}
              >
                {category.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      {sortedCategories.map((category) => (
        <div
          id={`category-${category.id}`}
          key={category.id}
          data-category-id={category.id}
          className="space-y-3 scroll-mt-[110px]"
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
              const isPromo = isProductPromo(product);
              const isOnSale = Boolean(product.isOnSale);
              const isNew = Boolean(product.isNew);

              return (
                <div
                  key={product.id}
                  className={cn(
                    "public-menu-v2-card relative min-h-[96px] overflow-hidden rounded-xl border-[1px] border-slate-100 bg-white shadow-sm transition-transform transition-shadow duration-150 ease-out hover:-translate-y-[1px] hover:shadow-md active:-translate-y-[1px] active:shadow-md motion-reduce:transform-none motion-reduce:transition-none sm:min-h-[128px]",
                    isPromo && "border-2 border-amber-400 bg-amber-50/40 shadow-md shadow-amber-200/70 ring-1 ring-amber-300"
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
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className="truncate font-semibold leading-tight text-slate-900">{product.name}</p>
                          {isPromo ? (
                            <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
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
