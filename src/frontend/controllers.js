function createWalletControllers(model, view, platform) {
  const t = view.text;
  const operationLabels = {
    inspectAddress: 'checkingBalance', inspectTron: 'checkingBalance', walletState: 'loading',
    listCounterparties: 'loadingContacts', listPayments: 'checkingHistory', loadTransferHistory: 'checkingHistory',
    transactionStatus: 'checkingStatus', quoteSwap: 'loadingQuote', sendToken: 'checkingFee',
    executeSwap: 'checkingFee', copyPrivateKey: 'copyingSecret'
  };

  async function call(name, args = {}) {
    model.startOperation(name, operationLabels[name] || 'working');
    try { return await platform.api.call(name, args); }
    finally { model.finishOperation(name); }
  }

  function message(text, error = false) { model.setUi({ notice: { text, error } }); }

  function errorText(error) {
    const raw = typeof error === 'string' ? error : error?.message || '';
    if (raw.startsWith('Balance is temporarily unavailable')) return t('balanceUnavailable');
    if (raw.startsWith('Transaction history is temporarily unavailable')) return t('historyError');
    if (model.data.ui.language === 'en' && /[А-Яа-яЁё]/.test(raw)) return t('genericError');
    if (model.data.ui.language === 'ru' && /^[A-Za-z]/.test(raw) && !/swap|quote|USDT|USDC|ETH|Ethereum|wallet|network|allowance|approval|[0-9a-f]{64}/i.test(raw)) return t('genericError');
    return raw || t('genericError');
  }

  async function run(task, progress = 'working') {
    if (model.busy) return;
    model.startOperation('action', progress);
    message('');
    try { await task(); }
    catch (error) { message(errorText(error), true); }
    finally { model.finishOperation('action'); }
  }

  async function refreshBalance() {
    const who = model.activeAddress;
    if (!who) return;
    try { model.setOverview(who, await call('inspectAddress', { walletAddress: who })); }
    catch (error) { model.setOverviewUnavailable(who); throw error; }
  }

  async function refreshTron() {
    const who = model.activeAddress;
    if (!who) return;
    try { model.setTronOverview(who, await call('inspectTron', { walletAddress: who })); }
    catch (error) { model.setTronUnavailable(who); throw error; }
  }

  async function loadState(refresh = true) {
    model.setWalletState(await call('walletState'));
    if (refresh && model.activeAddress) {
      try { await refreshBalance(); }
      catch (error) { if (!model.data.overview) throw error; }
      try { await refreshTron(); } catch { /* The model retains the balance and its warning. */ }
    }
  }

  async function loadContacts() { model.setContacts(await call('listCounterparties')); }

  function showScreen(name) {
    model.setUi({ screen: name });
    if (name === 'pay') {
      loadContacts().catch((error) => message(errorText(error), true));
      const who = model.activeAddress;
      if (who) call('listPayments', { walletAddress: who }).then((payments) => model.setHistory(who, { payments })).catch(() => {});
    }
  }

  function validAmount(value) { return /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value) && Number(value) > 0; }

  return {
    start() {
      try { model.setUi({ language: localStorage.getItem('cw-language') || (navigator.language.startsWith('ru') ? 'ru' : 'en') }); }
      catch { model.setUi({ language: navigator.language.startsWith('ru') ? 'ru' : 'en' }); }
      return run(() => loadState(), 'loading');
    },

    changeLanguage(language) {
      model.setUi({ language });
      try { localStorage.setItem('cw-language', language); } catch {}
    },

    showScreen,
    openReceive() { model.setUi({ modal: 'receive-dialog' }); },
    togglePrivacy() { model.setUi({ privacy: !model.data.ui.privacy }); },
    setPanel(id, open) { model.setPanel(id, open); },
    closeModal(id) { model.closeModal(id); },
    cancelModal(id) {
      const { pending } = model.data.ui;
      if (id === 'backup' || (id === 'payment-password-dialog' && pending.payment) || (id === 'secret-dialog' && pending.secret)) return;
      model.closeModal(id);
    },

    selectWallet(walletAddress) {
      return run(async () => {
        await call('selectWallet', { walletAddress });
        view.resetPaymentForm();
        await loadState();
      }, 'loading');
    },

    saveWatchWallet({ walletAddress, label }) {
      return run(async () => {
        await call('saveWatchAddress', { walletAddress: walletAddress.trim(), label });
        view.resetWatchWalletForm();
        model.setPanel('watch-wallet-setup', false);
        await loadState();
        message(t('walletSaved'));
      }, 'loading');
    },

    renameWallet(label) {
      return run(async () => {
        await call('renameWallet', { walletAddress: model.activeAddress, label });
        await loadState(false);
        message(t('nameSaved'));
      }, 'loading');
    },

    removeWallet() {
      return run(async () => {
        const who = model.activeAddress;
        if (!who) return;
        if (!await platform.dialog.confirm(t('removeConfirm'), { detail: `${who}\n${t('removeHint')}`, ok: t('delete'), cancel: t('cancel') })) return;
        await call('removeWallet', { walletAddress: who });
        await loadState();
        message(t('walletRemoved'));
      });
    },

    refreshBalances() {
      return run(async () => {
        const results = await Promise.allSettled([refreshBalance(), refreshTron()]);
        if (results[0].status === 'rejected') throw results[0].reason;
      }, 'checkingBalance');
    },

    copyAddress(network) {
      return run(async () => {
        await call(network === 'tron' ? 'copyTronAddress' : 'copyWalletAddress', { walletAddress: model.activeAddress });
        message(t('addressCopied'));
      });
    },

    resetSwap() { model.resetSwap(); },
    quoteSwap({ tokenIn, value }) {
      return run(async () => {
        model.resetSwap();
        value = value.trim().replace(',', '.');
        if (!validAmount(value)) throw new Error(t('checkAmount'));
        const who = model.activeAddress;
        model.setSwapQuote(who, await call('quoteSwap', { walletAddress: who, tokenIn, value }));
      }, 'loading');
    },

    continueSwap() {
      if (model.busy) return;
      const quote = model.data.swapQuoteData;
      if (!quote || Date.parse(quote.expiresAt) <= Date.now()) { model.resetSwap(); message(t('quoteExpires'), true); return; }
      model.openPayment({ kind: 'swap', quoteId: quote.id, locale: model.data.ui.language });
    },

    openSecret() { model.setUi({ modal: 'secret-dialog', secretError: '' }); },
    async copyPrivateKey(password) {
      if (model.busy) return;
      model.setUi({ secretError: '' });
      model.startOperation('secret', 'copyingSecret');
      try {
        const result = await call('copyPrivateKey', { walletAddress: model.activeAddress, password, locale: model.data.ui.language });
        model.closeModal('secret-dialog');
        if (!result?.cancelled) message(t('secretCopied'));
      } catch (error) { model.setUi({ secretError: errorText(error) }); }
      finally { model.finishOperation('secret'); }
    },

    refreshPayments() {
      return run(async () => {
        const who = model.activeAddress;
        model.setHistory(who, { payments: await call('listPayments', { walletAddress: who }) });
      }, 'checkingHistory');
    },

    loadHistory() {
      return run(async () => {
        const who = model.activeAddress;
        if (!who) { message(t('noWallet'), true); return; }
        const results = await Promise.allSettled([call('loadTransferHistory', { walletAddress: who }), call('listPayments', { walletAddress: who })]);
        if (who !== model.activeAddress) return;
        model.setHistory(who, {
          transfers: results[0].status === 'fulfilled' ? results[0].value.transfers : [],
          payments: results[1].status === 'fulfilled' ? results[1].value : []
        }, true);
        if (results[0].status === 'rejected') message(t('historyError'), true);
        else if (results[1].status === 'rejected') message(errorText(results[1].reason), true);
        else message(results[0].value.unavailable?.length ? `${t('partialHistory')}: ${results[0].value.unavailable.join(', ')}` : '');
      }, 'checkingHistory');
    },

    checkTransaction(txHash) {
      return run(async () => {
        model.setUi({ transactionStatus: await call('transactionStatus', { txHash: txHash.trim() }) });
        message(t('statusResult'));
      });
    },

    chooseContact(contact) { view.selectRecipient(contact); model.setPanel('contacts-panel', false); },
    editContact(contact) { view.editContact(contact); model.setPanel('contact-editor', true); },
    deleteContact(contact) {
      return run(async () => {
        if (!await platform.dialog.confirm(t('deleteContactConfirm'), { detail: contact.address, ok: t('delete'), cancel: t('cancel') })) return;
        await call('deleteCounterparty', { recipient: contact.address });
        await loadContacts();
        message(t('contactDeleted'));
      });
    },

    saveContact({ name, recipient, description }) {
      return run(async () => {
        const contact = await call('saveCounterparty', { name, recipient: recipient.trim(), description });
        view.resetContactForm();
        model.setPanel('contact-editor', false);
        await loadContacts();
        view.selectRecipient(contact);
        message(t('contactSaved'));
      });
    },

    saveInfuraKey(key) {
      return run(async () => { await call('saveInfuraKey', { key }); await loadState(false); message(t('apiSaved')); });
    },
    importWallet(credentials) {
      return run(async () => { await call('importWallet', credentials); await loadState(false); message(t('keyImported')); });
    },
    importCwgKey(credentials) {
      return run(async () => { await call('importCwgKey', credentials); await loadState(false); message(t('keyImported')); });
    },

    createWallet(credentials) {
      return run(async () => {
        const result = await call('createWallet', credentials);
        view.showBackupKey(result.backupKey);
        model.setUi({ modal: 'backup' });
        showScreen('wallet');
        await loadState(false);
        if (!model.data.overview) model.setOverview(result.address, { address: result.address, eth: '0', usdt: '0', usdc: '0', staleFields: [] });
        if (!model.data.tronOverview) model.setTronOverview(result.address, { trx: '0', usdt: '0', activated: false });
        message(t('walletCreated'));
      }, 'creatingWallet');
    },
    hideBackup() { model.closeModal('backup'); message(t('backupHidden')); },
    deleteSigningKey() {
      return run(async () => {
        if (await call('deleteWallet', { locale: model.data.ui.language })) { await loadState(false); message(t('keyDeleted')); }
      });
    },

    preparePayment({ recipient, value, token, description, contactName }) {
      if (model.busy) return;
      value = value.trim().replace(',', '.');
      recipient = recipient.trim();
      if (!/^0x[0-9a-fA-F]{40}$/.test(recipient) || !validAmount(value)) { message(t('checkAmount'), true); return; }
      const blockReason = !model.activeAddress ? 'noWallet' : !model.data.state?.keychainAvailable ? 'keychainUnavailable' : !model.data.state?.signerAddress ? 'watchOnly' : null;
      if (blockReason) { message(t(blockReason), true); return; }
      model.openPayment({ kind: 'payment', walletAddress: model.activeAddress, recipient, value, token, description: description.trim(), contactName: contactName.trim(), locale: model.data.ui.language });
    },

    async confirmPayment(password) {
      const draft = model.data.ui.paymentDraft;
      if (model.busy || !draft) return;
      model.setUi({ paymentError: '' });
      model.startOperation('payment', 'checkingFee');
      try {
        const result = await call(draft.kind === 'swap' ? 'executeSwap' : 'sendToken', { ...draft, password });
        model.closeModal('payment-password-dialog');
        if (result.cancelled) { message(t('paymentCancelled')); return; }
        view.applyPaymentResult(result.hash, draft.kind);
        if (draft.kind === 'swap') model.resetSwap();
        let contactSaveFailed = false;
        if (draft.kind === 'payment' && draft.contactName && !model.findContact(draft.recipient)) {
          try {
            await call('saveCounterparty', { name: draft.contactName, recipient: draft.recipient, description: '' });
            view.clearRecipientName();
            await loadContacts();
          } catch { contactSaveFailed = true; }
        }
        showScreen('history');
        model.startOperation('paymentHistory', 'checkingHistory');
        const who = model.activeAddress;
        try { model.setHistory(who, { payments: await call('listPayments', { walletAddress: who }) }, true); }
        catch { model.setHistory(who, {}, true); }
        finally { model.finishOperation('paymentHistory'); }
        message(result.metadataSaved ? `${t(draft.kind === 'swap' ? 'swapSent' : 'paymentSent')}: ${result.hash}` : `${t('paymentNotSaved')} ${result.hash}`, !result.metadataSaved);
        if (contactSaveFailed) message(model.data.ui.language === 'en' ? 'Payment sent, but the contact could not be saved.' : 'Платёж отправлен, но контакт сохранить не удалось.', true);
        refreshBalance().catch(() => {});
      } catch (error) {
        try { await loadState(false); } catch {}
        model.setUi({ paymentError: errorText(error) });
      } finally { model.finishOperation('payment'); }
    }
  };
}
