# Teste manual — envio confiável do pedido público

1. Abra o menu público em `/p/:slug`, adicione itens e preencha checkout.
2. No Chrome DevTools, ative **Network > Offline**.
3. Clique em **Finalizar pedido**.
4. Valide que aparece a UI de pendência com mensagem de reenvio automático e botões:
   - **Tentar agora**
   - **Cancelar pedido pendente**
5. Ainda offline, confira no `localStorage` a chave `smartpedidos:public:pendingOrder` com:
   - `storeSlug`
   - `clientOrderId`
   - `payload`
   - `createdAt`
   - `attempts`
6. Volte para **Online** no DevTools.
7. Confirme que o frontend reenvia automaticamente, conclui o pedido e limpa `smartpedidos:public:pendingOrder`.
8. Para validar idempotência, repita o envio com o mesmo `clientOrderId` (via retry do pendente) e confirme que a API devolve o mesmo pedido, sem duplicar.
