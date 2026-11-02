// Loaded before app.js as a classic script so it also works with file://.
const walletModel = (() => {
  function immutable(value) {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return Object.freeze(value.map(immutable));
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, immutable(item)])));
  }

  let data = immutable({
    state: null,
    overview: null,
    overviewCached: false,
    tronOverview: null,
    tronUnavailable: false,
    contacts: [],
    transfers: [],
    payments: [],
    historyLoaded: false,
    swapQuoteData: null,
    overviewUnavailable: false,
    ui: {
      language: 'ru',
      screen: 'wallet',
      modal: null,
      privacy: false,
      paymentDraft: null,
      paymentError: '',
      secretError: '',
      notice: { text: '', error: false },
      transactionStatus: null,
      panels: { 'watch-wallet-setup': false, 'contacts-panel': false, 'contact-editor': false },
      pending: {}
    }
  });
  const listeners = new Set();

  // Commit the entire patch before notifying subscribers. Snapshots are read-only.
  function update(patch, fields = Object.keys(patch)) {
    data = Object.freeze({ ...data, ...immutable(patch) });
    const changed = Object.freeze(fields);
    for (const listener of [...listeners]) listener(data, changed);
  }

  function isActive(address) {
    return !!address && address === data.state?.activeAddress;
  }

  function setUi(patch) {
    update({ ui: { ...data.ui, ...patch } }, Object.keys(patch).map((key) => `ui.${key}`));
  }

  return Object.freeze({
    get data() { return data; },
    get busy() { return !!(data.ui.pending.action || data.ui.pending.payment || data.ui.pending.secret); },

    setUi,

    openPayment(paymentDraft) {
      setUi({ paymentDraft, paymentError: '', modal: 'payment-password-dialog' });
    },

    closeModal(id) {
      if (data.ui.modal !== id) return;
      setUi({ modal: null, ...(id === 'payment-password-dialog' ? { paymentDraft: null } : {}) });
    },

    setPanel(id, open) {
      if (data.ui.panels[id] !== open) setUi({ panels: { ...data.ui.panels, [id]: open } });
    },

    startOperation(name, label = 'working') {
      const count = (data.ui.pending[name]?.count || 0) + 1;
      setUi({ pending: { ...data.ui.pending, [name]: { count, label } } });
    },

    finishOperation(name) {
      const operation = data.ui.pending[name];
      if (!operation) return;
      const pending = { ...data.ui.pending };
      if (operation.count > 1) pending[name] = { ...operation, count: operation.count - 1 };
      else delete pending[name];
      setUi({ pending });
    },

    // Subscribers receive (snapshot, changedFields); the return value unsubscribes.
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    setWalletState(state) {
      const switched = (state?.activeAddress || null) !== (data.state?.activeAddress || null);
      update({
        state,
        overview: state?.cachedOverview || null,
        overviewCached: !!state?.cachedOverview,
        overviewUnavailable: false,
        tronOverview: state?.cachedTron || null,
        tronUnavailable: switched ? false : data.tronUnavailable,
        ...(switched ? {
          transfers: [], payments: [], historyLoaded: false, swapQuoteData: null,
          ui: {
            ...data.ui, transactionStatus: null, paymentDraft: null, paymentError: '', secretError: '',
            modal: ['payment-password-dialog', 'secret-dialog'].includes(data.ui.modal) ? null : data.ui.modal
          }
        } : {})
      });
    },

    setOverview(address, overview) {
      if (isActive(address)) update({ overview, overviewCached: false, overviewUnavailable: false });
    },

    setOverviewUnavailable(address) {
      if (isActive(address)) update({ overviewUnavailable: true });
    },

    setTronOverview(address, tronOverview) {
      if (isActive(address)) update({ tronOverview, tronUnavailable: false });
    },

    setTronUnavailable(address) {
      if (isActive(address)) update({ tronUnavailable: true });
    },

    setContacts(contacts) {
      update({ contacts });
    },

    setHistory(address, { transfers, payments }, loaded = data.historyLoaded) {
      if (!isActive(address)) return;
      update({
        ...(transfers === undefined ? {} : { transfers }),
        ...(payments === undefined ? {} : { payments }),
        ...(loaded === data.historyLoaded ? {} : { historyLoaded: loaded })
      });
    },

    setSwapQuote(address, swapQuoteData) {
      if (isActive(address)) update({ swapQuoteData });
    },

    resetSwap() {
      update({ swapQuoteData: null });
    }
  });
})();
