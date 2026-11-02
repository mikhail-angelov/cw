// Classic scripts keep the local file:// frontend independent of a bundler.
function createWalletViews(model) {
  let handlers;
  function compose(children, bind) {
    return {
      bind(actions) { bind?.(actions); for (const child of children) child.bind?.(actions); },
      render(changed) { for (const child of children) child.render(changed); }
    };
  }

  function observe(dependencies, render) {
    return {
      render(changed) {
        // A parent change (e.g. ui) also invalidates its children's dependencies.
        if (!changed || dependencies.some((key) => changed.includes(key) || changed.includes(key.split('.')[0]))) render();
      }
    };
  }
  const $ = (id) => document.getElementById(id);

  const ru = {
    mainnet:'Основная сеть',wallet:'Кошелёк',addWallet:'Добавить',walletName:'Название (необязательно)',saveWallet:'Сохранить адрес',cancel:'Отмена',overview:'ОБЗОР',balances:'Баланс',refresh:'Обновить',addFirstWallet:'Добавьте публичный адрес или создайте кошелёк.',pay:'Платёж',history:'История',settings:'Настройки',newPayment:'Новый платёж',contact:'Контрагент',recipient:'Адрес получателя',amount:'Сумма USDT',paymentNote:'Описание платежа (только здесь)',paymentNoteExample:'Например, счёт за октябрь',asapNote:'Отправка сразу после подтверждения. Пароль вводится вручную каждый раз.',continuePayment:'Продолжить',counterparties:'Контрагенты',addContact:'Добавить контрагента',name:'Имя',address:'Адрес Ethereum',description:'Описание (необязательно)',saveContact:'Сохранить контрагента',historyOnDemand:'История загружается только по кнопке.',loadHistory:'Загрузить историю',usdtTransfers:'Переводы USDT',myPayments:'Мои платежи',historyWarning:'Перед платежом сверяйте адрес получателя целиком: мелкие входящие переводы могут подменять адреса в истории.',checkTransaction:'Проверить транзакцию по хешу',checkStatus:'Проверить статус',importKey:'Добавить ключ подписи',keyExplainer:'Ключ нужен только для платежа с выбранного адреса и хранится в защищённом хранилище системы.',privateKey:'Приватный ключ',newPassword:'Новый пароль платежа',repeatPassword:'Повторите пароль',importCwg:'Импорт из cwg',cwgPassword:'Пароль cwg',createWallet:'Создать кошелёк',backupNote:'Приложение покажет новый приватный ключ один раз для резервной копии.',saveBackup:'Сохраните резервную копию',backupWarning:'Без резервной копии ключ нельзя восстановить после потери системного хранилища.',savedBackup:'Я сохранил ключ',networkSettings:'Сеть',saveApiKey:'Сохранить API key',deleteKey:'Удалить ключ подписи',removeWallet:'Удалить адрес из списка',confirmPayment:'ПОДТВЕРЖДЕНИЕ ПЛАТЕЖА',enterPassword:'Введите пароль платежа',manualPassword:'Пароль вводится вручную каждый раз',checkFee:'Проверить комиссию',newRecipient:'Новый получатель',noWallet:'Выберите или добавьте кошелёк.',watchOnly:'Для платежа добавьте ключ подписи в настройках.',noInfura:'Для отправки добавьте Infura API key в настройках.',ready:'Готов к отправке. Пароль потребуется для каждого платежа.',keychainUnavailable:'Защищённое хранилище недоступно; платежи временно отключены.',keyProtected:'Ключ подписи защищён паролем.',keyMissing:'У этого адреса нет ключа подписи.',infuraSaved:'Infura API key сохранён в защищённом хранилище системы.',infuraMissing:'Infura API key ещё не добавлен.',lastSaved:'Сохранено',updated:'Обновлено',balanceUnavailable:'Временно недоступно',networkTransfersEmpty:'Переводов USDT пока нет.',localPaymentsEmpty:'Локальных платежей пока нет.',historyError:'История Blockscout временно недоступна.',lastPayment:'Последний платёж',noPayments:'Платежей пока нет',choose:'Выбрать',edit:'Изменить',delete:'Удалить',removeConfirm:'Удалить этот адрес из списка?',removeHint:'Ключ подписи удаляется отдельно.',deleteContactConfirm:'Удалить контрагента?',contactSaved:'Контрагент сохранён.',contactDeleted:'Контрагент удалён.',walletSaved:'Кошелёк добавлен.',walletRemoved:'Адрес удалён.',keyImported:'Ключ сохранён в защищённом хранилище системы.',keyDeleted:'Ключ удалён из защищённого хранилища системы.',apiSaved:'Infura API key сохранён.',walletCreated:'Кошелёк создан. Сохраните резервную копию ключа.',backupHidden:'Резервная копия скрыта.',paymentCancelled:'Отправка отменена.',paymentSent:'Платёж отправлен. Дата появится после подтверждения сетью.',paymentNotSaved:'Платёж отправлен, но локальную запись сохранить не удалось.',checkAmount:'Проверьте адрес и сумму USDT (до 6 знаков после точки).',passwordMismatch:'Пароли не совпадают.',checkingFee:'Проверяю пароль и комиссию…',checkingHistory:'Загружаю историю…',checkingBalance:'Обновляю баланс…',loading:'Загружаю кошельки…',statusPending:'Ожидает подтверждения',statusConfirmed:'Подтверждён',statusFailed:'Не выполнен',sentAt:'Отправлено',paidAt:'Оплачено',failedAt:'Ошибка',to:'Кому',from:'От',hash:'Хеш',note:'Описание',details:'Адреса и хеш',incoming:'Входящий перевод',outgoing:'Исходящий перевод',statusResult:'Статус получен.',genericError:'Не удалось выполнить действие. Проверьте данные и попробуйте ещё раз.'
  };

  const en = {
    mainnet:'Mainnet',wallet:'Wallet',addWallet:'Add',walletName:'Name (optional)',saveWallet:'Save address',cancel:'Cancel',overview:'OVERVIEW',balances:'Balances',refresh:'Refresh',addFirstWallet:'Add a public address or create a wallet.',pay:'Pay',history:'History',settings:'Settings',newPayment:'New payment',contact:'Contact',recipient:'Recipient address',amount:'USDT amount',paymentNote:'Payment note (local only)',paymentNoteExample:'For example, October invoice',asapNote:'Sent immediately after confirmation. Enter your password manually each time.',continuePayment:'Continue',counterparties:'Contacts',addContact:'Add contact',name:'Name',address:'Ethereum address',description:'Description (optional)',saveContact:'Save contact',historyOnDemand:'History is loaded only when requested.',loadHistory:'Load history',usdtTransfers:'USDT transfers',myPayments:'My payments',historyWarning:'Check the complete recipient address before paying. Small incoming transfers can poison transaction history.',checkTransaction:'Check a transaction hash',checkStatus:'Check status',importKey:'Add signing key',keyExplainer:'A signing key is only needed to pay from the selected address. It is stored in the system secure storage.',privateKey:'Private key',newPassword:'New payment password',repeatPassword:'Repeat password',importCwg:'Import from cwg',cwgPassword:'cwg password',createWallet:'Create wallet',backupNote:'The new private key is shown once for backup.',saveBackup:'Save your backup',backupWarning:'Without a backup, lost secure storage means a lost private key.',savedBackup:'I saved the key',networkSettings:'Network',saveApiKey:'Save API key',deleteKey:'Remove signing key',removeWallet:'Remove address from list',confirmPayment:'CONFIRM PAYMENT',enterPassword:'Enter payment password',manualPassword:'Enter the password manually every time',checkFee:'Check fee',newRecipient:'New recipient',noWallet:'Select or add a wallet.',watchOnly:'Add a signing key in Settings to make payments.',noInfura:'Add an Infura API key in Settings to send payments.',ready:'Ready to pay. A password is required for every payment.',keychainUnavailable:'Secure storage is unavailable; payments are temporarily disabled.',keyProtected:'Signing key is password protected.',keyMissing:'This address has no signing key.',infuraSaved:'Infura API key is saved in system secure storage.',infuraMissing:'Infura API key has not been added.',lastSaved:'Saved',updated:'Updated',balanceUnavailable:'Temporarily unavailable',networkTransfersEmpty:'No USDT transfers yet.',localPaymentsEmpty:'No local payments yet.',historyError:'Blockscout history is temporarily unavailable.',lastPayment:'Last payment',noPayments:'No payments yet',choose:'Choose',edit:'Edit',delete:'Delete',removeConfirm:'Remove this address from the list?',removeHint:'Remove the signing key separately.',deleteContactConfirm:'Delete this contact?',contactSaved:'Contact saved.',contactDeleted:'Contact deleted.',walletSaved:'Wallet added.',walletRemoved:'Address removed.',keyImported:'Key saved in system secure storage.',keyDeleted:'Key removed from system secure storage.',apiSaved:'Infura API key saved.',walletCreated:'Wallet created. Save a backup of the key.',backupHidden:'Backup hidden.',paymentCancelled:'Payment cancelled.',paymentSent:'Payment sent. The payment date appears after network confirmation.',paymentNotSaved:'Payment sent, but the local record could not be saved.',checkAmount:'Check the address and USDT amount (up to 6 decimals).',passwordMismatch:'Passwords do not match.',checkingFee:'Checking password and fee…',checkingHistory:'Loading history…',checkingBalance:'Refreshing balances…',loading:'Loading wallets…',statusPending:'Pending confirmation',statusConfirmed:'Confirmed',statusFailed:'Failed',sentAt:'Sent',paidAt:'Paid',failedAt:'Failed',to:'To',from:'From',hash:'Hash',note:'Note',details:'Addresses and hash',incoming:'Incoming transfer',outgoing:'Outgoing transfer',statusResult:'Status received.',genericError:'Could not complete the request. Check the details and try again.'
  };

  Object.assign(ru, { copyAddress:'Копировать адрес', addressCopied:'Адрес скопирован', copySecret:'Копировать приватный ключ', secretWarning:'Любой, у кого есть ключ, может потратить все средства. Буфер обмена может синхронизироваться с другими устройствами.', secretCopied:'Приватный ключ скопирован. Буфер будет очищен через 30 секунд, если не изменится.', token:'Токен', amount:'Сумма', swap:'Обмен', swapTitle:'Обмен USDT ↔ USDC', giveToken:'Отдать', swapAmount:'Сумма обмена', swapExplainer:'Прямой пул Uniswap v3 в Ethereum mainnet. Для разрешения и обмена нужен ETH на комиссии.', getQuote:'Получить котировку', continueToPassword:'Продолжить к паролю', tokenTransfers:'Переводы USDT и USDC', myPayments:'Мои операции', swapQuote:'Котировка', swapMinimum:'Минимум к получению', swapPoolFee:'Комиссия пула', quoteExpires:'Действует до', swapSent:'Обмен отправлен', partialHistory:'История некоторых токенов временно недоступна', swapOperation:'Обмен' });

  Object.assign(en, { copyAddress:'Copy address', addressCopied:'Address copied', copySecret:'Copy private key', secretWarning:'Anyone with this key can spend all funds. The clipboard may sync to other devices.', secretCopied:'Private key copied. Clipboard clears after 30 seconds if unchanged.', token:'Token', amount:'Amount', swap:'Swap', swapTitle:'Swap USDT ↔ USDC', giveToken:'Give', swapAmount:'Swap amount', swapExplainer:'Direct Uniswap v3 pool on Ethereum mainnet. ETH is required for approval and swap fees.', getQuote:'Get quote', continueToPassword:'Continue to password', tokenTransfers:'USDT and USDC transfers', myPayments:'My operations', swapQuote:'Quote', swapMinimum:'Minimum received', swapPoolFee:'Pool fee', quoteExpires:'Valid until', swapSent:'Swap submitted', partialHistory:'History for some tokens is temporarily unavailable', swapOperation:'Swap' });

  Object.assign(ru, { tronUnavailable:'Баланс TRON временно недоступен. Показаны последние сохранённые значения, если они есть.' });

  Object.assign(ru, { tronNeedsActivation:'TRON-адрес ещё не активирован.' });

  Object.assign(en, { tronNeedsActivation:'TRON address is not active yet.' });

  Object.assign(en, { tronUnavailable:'TRON balance is temporarily unavailable. Last saved values are shown where possible.' });

  Object.assign(ru, { settingsGuide:'Для просмотра балансов ничего вводить не нужно. Чтобы отправлять или обменивать токены, добавьте свой приватный ключ либо создайте новый кошелёк и придумайте пароль платежа от 12 символов. Это новый пароль приложения: он шифрует ключ, вводится вручную при каждой операции и не восстанавливается.', keyExplainer:'Введите приватный ключ выбранного кошелька (0x…). Он нужен только для отправки и обмена и хранится зашифрованным в защищённом хранилище системы. Никому не сообщайте ключ и пароль.', networkSettings:'Личный RPC (необязательно)', infuraHelp:'Приложение работает через публичный Ethereum RPC без настройки. Если нужен личный сервер, создайте проект Ethereum Mainnet на infura.io и вставьте его Project ID. Нужен именно ID, не URL и не пароль кошелька.', infuraPlaceholder:'Infura Project ID', saveApiKey:'Сохранить Project ID', publicRpcDefault:'Публичный Ethereum RPC включён. Ничего вводить не нужно.' });

  Object.assign(en, { settingsGuide:'No setup is needed to view balances. To send or swap tokens, add your private key or create a new wallet and choose a payment password of at least 12 characters. This is a new app password: it encrypts the key, must be typed for every operation, and cannot be recovered.', keyExplainer:'Enter the private key (0x…) for the selected wallet. It is needed for payments and swaps and is encrypted in the system secure storage. Never share the key or password.', networkSettings:'Personal RPC (optional)', infuraHelp:'The app works with a public Ethereum RPC without setup. For a personal endpoint, create an Ethereum Mainnet project at infura.io and paste its Project ID. Enter the ID, not a URL or wallet password.', infuraPlaceholder:'Infura Project ID', saveApiKey:'Save Project ID', publicRpcDefault:'Public Ethereum RPC is enabled. No input is needed.' });

  Object.assign(ru, { cwgHelp:'Только если у вас есть wallet_key из cwg: введите старый пароль cwg, затем придумайте новый пароль для этого приложения.', backupNote:'Создаётся новый ключ и новые адреса Ethereum и TRON. Приложение покажет ключ один раз для резервной копии. Сохраните его вне приложения.' });

  Object.assign(en, { cwgHelp:'Only if you have a wallet_key from cwg: enter your old cwg password, then choose a new password for this app.', backupNote:'A new key creates new Ethereum and TRON addresses. The app shows the key once for backup. Store it outside the app.' });

  Object.assign(ru, { saveName:'Сохранить название', nameSaved:'Название кошелька сохранено.', creatingWallet:'Создаю кошелёк…', backupInstructions:'Сохраните этот приватный ключ в безопасном месте вне приложения. Любой, у кого есть ключ, может распоряжаться средствами. Без него кошелёк нельзя восстановить после потери системного хранилища.' });

  Object.assign(en, { saveName:'Save name', nameSaved:'Wallet name saved.', creatingWallet:'Creating wallet…', backupInstructions:'Store this private key somewhere safe outside the app. Anyone with the key can control your funds. Without it, the wallet cannot be recovered if system storage is lost.' });

  Object.assign(ru, { addWatchWallet:'Добавить адрес для просмотра', watchWalletHelp:'Добавьте существующий публичный адрес Ethereum, чтобы просматривать баланс без приватного ключа.', addFirstWallet:'Добавьте адрес или создайте кошелёк в настройках.' });

  Object.assign(en, { addWatchWallet:'Add a watch-only address', watchWalletHelp:'Add an existing public Ethereum address to view its balance without a private key.', addFirstWallet:'Add an address or create a wallet in Settings.' });

  Object.assign(ru, { totalBalance:'Общий баланс', stableNote:'Сумма USDT и USDC в обеих сетях, без ETH и TRX', assets:'Активы', actionSend:'Отправить', receive:'Получить', receiveTitle:'Получить на адрес', close:'Закрыть', getApprox:'Получите (примерно)', hideBalance:'Скрыть суммы', showBalance:'Показать суммы', tronAddressLabel:'TRON-адрес' });

  Object.assign(en, { totalBalance:'Total balance', stableNote:'Sum of USDT and USDC across both networks, excluding ETH and TRX', assets:'Assets', actionSend:'Send', receive:'Receive', receiveTitle:'Receive to address', close:'Close', getApprox:'You receive (estimated)', hideBalance:'Hide amounts', showBalance:'Show amounts', tronAddressLabel:'TRON address' });

  Object.assign(ru, { back:'Назад', recipientName:'Имя (необязательно)', recipientNameHint:'Например, Иван — добавится в контрагенты при отправке', amountGeneric:'Сумма', actionPay:'Оплатить', refreshStatus:'Обновить статус' });

  Object.assign(en, { back:'Back', recipientName:'Name (optional)', recipientNameHint:'For example, Ivan — saved as a contact when sent', amountGeneric:'Amount', actionPay:'Pay', refreshStatus:'Refresh status' });

  Object.assign(ru, { working:'Выполняю…', loadingContacts:'Загружаю контакты…', checkingStatus:'Проверяю транзакцию…', loadingQuote:'Получаю котировку…', copyingSecret:'Копирую приватный ключ…' });

  Object.assign(en, { working:'Working…', loadingContacts:'Loading contacts…', checkingStatus:'Checking transaction…', loadingQuote:'Getting quote…', copyingSecret:'Copying private key…' });

  const t = (key) => (model.data.ui.language === 'en' ? en : ru)[key] || key;

  const ICONS = {
    copy: ['M8 8h11a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V8Z', 'M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3'],
    refresh: ['M20 7v5h-5', 'M4 17v-5h5', 'M5.5 9a7 7 0 0 1 12-2L20 12', 'M18.5 15a7 7 0 0 1-12 2L4 12'],
    plus: ['M12 5v14', 'M5 12h14'],
    qr: ['M4 4h6v6H4z', 'M14 4h6v6h-6z', 'M4 14h6v6H4z', 'M14 14h3v3h-3z', 'M19 19h1v1h-1z'],
    eye: ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z', 'M12 9a3 3 0 1 0 0 6 3 3 0 1 0 0-6'],
    'eye-slash': ['M3 3l18 18', 'M10.6 10.7a3 3 0 0 0 4.2 4.2', 'M2 12s3.5-7 10-7c1.7 0 3.2.5 4.5 1.3M22 12s-3.5 7-10 7c-1.7 0-3.2-.5-4.5-1.3'],
    'arrow-up': ['M12 19V5', 'm5 12 7-7 7 7'],
    'arrow-down': ['M12 5v14', 'm19 12-7 7-7-7'],
    swap: ['M4 8h16', 'm15 4 5 4-5 4', 'M20 16H4', 'm9 12-5 4 5 4'],
    clock: ['M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18', 'M12 7v5l3 2'],
    wallet: ['M3 7a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v2', 'M3 7v10a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1H5a2 2 0 0 1-2-2Z', 'M16 13h2'],
    gear: ['M12 15a3 3 0 1 0 0-6 3 3 0 1 0 0 6', 'M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2-1.2L14.3 3h-4l-.3 2.6a7 7 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2 1.2l.3 2.6h4l.3-2.6a7 7 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2Z'],
    back: ['M19 12H5', 'm12 19-7-7 7-7']
  };

  function makeIcon(name) {
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('fill', 'none');
    icon.setAttribute('stroke', 'currentColor');
    icon.setAttribute('stroke-width', '2');
    icon.setAttribute('stroke-linecap', 'round');
    icon.setAttribute('stroke-linejoin', 'round');
    icon.setAttribute('aria-hidden', 'true');
    for (const d of ICONS[name] || []) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      icon.append(path);
    }
    return icon;
  }

  function injectIcons() { document.querySelectorAll('[data-icon]').forEach((node) => { node.querySelector('svg')?.remove(); node.prepend(makeIcon(node.dataset.icon)); }); }

  function setIcon(node, name) { node.dataset.icon = name; node.querySelector('svg')?.remove(); node.prepend(makeIcon(name)); }

  function translate() {
    document.documentElement.lang = model.data.ui.language;
    $('language').value = model.data.ui.language;
    document.querySelectorAll('[data-i18n]').forEach((node) => { (node.querySelector(':scope > .button-label') || node).textContent = t(node.dataset.i18n); });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((node) => { node.placeholder = t(node.dataset.i18nPlaceholder); });
    document.querySelectorAll('[data-i18n-title]').forEach((node) => { node.title = t(node.dataset.i18nTitle); });
  }

  const short = (value) => `${value.slice(0, 8)}…${value.slice(-6)}`;

  function displayBalance(value) {
    if (value === null || value === undefined) return '—';
    const [whole, fraction = ''] = String(value).split('.');
    const digits = whole.replace(/\B(?=(\d{3})+(?!\d))/g, model.data.ui.language === 'ru' ? ' ' : ',');
    const shownFraction = fraction.slice(0, 6).replace(/0+$/, '');
    return shownFraction ? `${digits}${model.data.ui.language === 'ru' ? ',' : '.'}${shownFraction}` : digits;
  }

  const dateText = (value) => new Date(value).toLocaleString(model.data.ui.language === 'en' ? 'en-US' : 'ru-RU', { dateStyle: 'medium', timeStyle: 'short' });

  function renderWallets() {
    const select = $('wallet-select'); const selected = model.activeAddress; select.replaceChildren();
    if (!model.data.state?.wallets.length) select.add(new Option(t('noWallet'), ''));
    else for (const wallet of model.data.state.wallets) select.add(new Option(`${wallet.label || short(wallet.address)}`, wallet.address));
    select.value = selected || '';
    $('active-address').textContent = selected || '';
    $('tron-address').textContent = model.data.state?.tronAddress || '';
    $('receive-eth').textContent = selected || '';
    $('receive-tron').textContent = model.data.state?.tronAddress || '';
    $('remove-wallet').hidden = !selected;
    $('rename-wallet-form').hidden = !selected;
    $('rename-wallet').value = model.data.state?.wallets.find((wallet) => wallet.address === selected)?.label || '';
  }

  function renderState() {
    if (!model.data.state) return;
    const selected = !!model.activeAddress;
    $('empty-state').hidden = selected;
    $('balance-content').hidden = !selected;
    $('key-setup').hidden = !selected || !!model.data.state.signerAddress || !model.data.state.keychainAvailable;
    $('delete-wallet').hidden = !model.data.state.signerAddress;
    $('copy-private-key').hidden = !model.data.state.signerAddress || !model.data.state.hasPaymentPassword;
    const canPay = selected && model.data.state.keychainAvailable && !!model.data.state.signerAddress && model.data.state.hasPaymentPassword;
    $('send-form').hidden = !selected;
    $('swap-form').hidden = !canPay;
    const reason = !selected ? 'noWallet' : !model.data.state.keychainAvailable ? 'keychainUnavailable' : !model.data.state.signerAddress ? 'watchOnly' : 'ready';
    $('payment-state').textContent = t(reason);
    $('swap-state').textContent = t(reason);
    $('key-state').textContent = !selected ? t('noWallet') : model.data.state.signerAddress ? t('keyProtected') : t('keyMissing');
    $('infura-state').textContent = t(model.data.state.hasInfuraKey ? 'infuraSaved' : 'publicRpcDefault');
  }

  function renderOverview() {
    for (const [symbol, key] of [['eth','eth'], ['usdt','usdt'], ['usdc','usdc']]) { const node = $(`inspect-${symbol}`); node.textContent = displayBalance(model.data.overview?.[key]); node.title = model.data.overview?.[key] ?? ''; }
    renderSwapBalance();
    const time = model.data.overview?.fetchedAt ? dateText(model.data.overview.fetchedAt) : '';
    $('updated-at').textContent = time ? `${t(model.data.overviewCached ? 'lastSaved' : 'updated')} ${time}` : '';
    const unavailable = model.data.overview?.staleFields || [model.data.overview?.eth === null && 'ETH', model.data.overview?.usdt === null && 'USDT', model.data.overview?.usdc === null && 'USDC'].filter(Boolean);
    $('data-warning').hidden = !unavailable.length; $('data-warning').textContent = unavailable.length ? `${model.data.ui.language === 'en' ? 'Live balance unavailable; showing last saved value where possible' : 'Свежий баланс недоступен; где возможно, показано последнее сохранённое значение'}: ${unavailable.join(', ')}` : '';
    if (model.data.overviewUnavailable) {
      $('data-warning').hidden = false;
      const saved = model.data.overview?.fetchedAt;
      $('data-warning').textContent = saved ? `${t('balanceUnavailable')}. ${t('lastSaved')}: ${dateText(saved)}` : t('balanceUnavailable');
    }
  }

  function renderTotalBalance() {
    const stables = [model.data.overview?.usdt, model.data.overview?.usdc, model.data.tronOverview?.usdt];
    const known = stables.some((value) => value !== null && value !== undefined);
    $('total-balance').textContent = known ? `≈ $${displayBalance(stables.reduce((sum, value) => sum + Number(value || 0), 0).toFixed(2))}` : '—';
  }

  function renderTron() {
    const { tronOverview, tronUnavailable } = model.data;
    for (const [id, key] of [['inspect-trx','trx'], ['inspect-tron-usdt','usdt']]) {
      const node = $(id); node.textContent = displayBalance(tronOverview?.[key]); node.title = tronOverview?.[key] ?? '';
    }
    const warning = tronUnavailable ? 'tronUnavailable' : tronOverview && !tronOverview.activated ? 'tronNeedsActivation' : null;
    $('tron-warning').hidden = !warning;
    $('tron-warning').textContent = warning ? t(warning) : '';
  }

  function renderSwapQuote() {
    const quote = model.data.swapQuoteData;
    $('swap-preview').hidden = !quote;
    if (!quote) return;
    $('swap-preview-output').textContent = `≈${quote.estimatedOut} ${quote.tokenOut}`;
    $('swap-preview-details').textContent = `${t('swapMinimum')}: ${quote.minOut} ${quote.tokenOut} · ${t('swapPoolFee')}: ${quote.poolFeePercent}% · ${t('quoteExpires')}: ${dateText(quote.expiresAt)}`;
  }

  function renderSwapBalance() { const token = $('swap-token').value; const value = token === 'USDT' ? model.data.overview?.usdt : model.data.overview?.usdc; $('swap-balance').textContent = value === null || value === undefined ? '' : `${t('balances')}: ${displayBalance(value)} ${token}`; }

  function renderScreen() {
    const name = model.data.ui.screen;
    if (!$(`screen-${name}`).classList.contains('active')) window.scrollTo(0, 0);
    for (const key of ['wallet','pay','swap','history','settings']) { const screen = $(`screen-${key}`); screen.hidden = name !== key; screen.classList.toggle('active', name === key); }
    document.querySelectorAll('.bottom-nav .nav-item').forEach((item) => item.classList.toggle('active', item.dataset.screen === name));
    const main = name === 'wallet';
    $('back-button').hidden = main;
    $('screen-title').hidden = main;
    $('network-badge').hidden = !main;
    $('screen-title').textContent = { pay:t('actionPay'), swap:t('swap'), history:t('history'), settings:t('settings') }[name] || '';
  }

  function historyRow({ icon, iconClass, title, date, note, sum, sumClass, status, details, action }) {
    const row = document.createElement('article'); row.className = 'history-item';
    const top = document.createElement('div'); top.className = 'history-top';
    const left = document.createElement('div'); left.className = 'history-left';
    const iconEl = document.createElement('span'); iconEl.className = `history-icon ${iconClass}`; iconEl.append(makeIcon(icon));
    const body = document.createElement('div');
    const titleEl = document.createElement('div'); titleEl.className = 'history-title'; titleEl.textContent = title; body.append(titleEl);
    if (date) { const dateEl = document.createElement('div'); dateEl.className = 'history-date'; dateEl.textContent = date; body.append(dateEl); }
    if (note) { const noteEl = document.createElement('div'); noteEl.className = 'history-date'; noteEl.textContent = note; body.append(noteEl); }
    left.append(iconEl, body);
    const prices = document.createElement('div'); prices.className = 'history-prices';
    const sumEl = document.createElement('div'); sumEl.className = `history-sum ${sumClass} maskable`; sumEl.textContent = sum; prices.append(sumEl);
    if (status) { const statusEl = document.createElement('span'); statusEl.className = `status ${status.key}`; statusEl.textContent = status.text; prices.append(statusEl); }
    if (action) { const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'secondary refresh-btn'; btn.textContent = action.label; btn.onclick = action.onclick; prices.append(btn); }
    top.append(left, prices); row.append(top);
    if (details) { const det = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = t('details'); const data = document.createElement('p'); data.className = 'mono details-text'; data.textContent = details; det.append(summary, data); row.append(det); }
    return row;
  }

  function historyEmpty(list, key) { const p = document.createElement('p'); p.className = 'history-empty'; p.textContent = t(key); list.append(p); }

  function renderTransfers() { const list = $('inspect-transfers'); list.replaceChildren(); if (!model.data.transfers.length) return historyEmpty(list, 'networkTransfersEmpty'); const sorted = [...model.data.transfers].sort((a, b) => Date.parse(b.date) - Date.parse(a.date)); for (const item of sorted) { const incoming = item.to.toLowerCase() === model.activeAddress?.toLowerCase(); list.append(historyRow({ icon: incoming ? 'arrow-down' : 'arrow-up', iconClass: incoming ? 'in' : 'out', title: t(incoming ? 'incoming' : 'outgoing'), date: dateText(item.date), sum: `${incoming ? '+' : '−'}${item.value} ${item.token || 'USDT'}`, sumClass: incoming ? 'in' : 'out', details: `${t('from')}: ${item.from}\n${t('to')}: ${item.to}\n${t('hash')}: ${item.hash}` })); } }

  function renderPayments() { const list = $('payment-history'); list.replaceChildren(); if (!model.data.payments.length) return historyEmpty(list, 'localPaymentsEmpty'); const sorted = [...model.data.payments].sort((a, b) => Date.parse(b.date || b.submittedAt) - Date.parse(a.date || a.submittedAt)); for (const payment of sorted) { const swap = payment.kind === 'swap'; const statusKey = payment.status === 'confirmed' ? 'statusConfirmed' : payment.status === 'failed' ? 'statusFailed' : 'statusPending'; list.append(historyRow({ icon: swap ? 'swap' : 'arrow-up', iconClass: swap ? 'swap' : 'out', title: swap ? `${t('swapOperation')} ${payment.token} → ${payment.tokenOut}` : payment.counterparty || short(payment.recipient), date: `${t(payment.status === 'pending' ? 'sentAt' : payment.status === 'confirmed' ? 'paidAt' : 'failedAt')} ${dateText(payment.date || payment.submittedAt)}`, note: payment.description || '', sum: swap ? `−${payment.amount} ${payment.token} → ≈${payment.expectedOut} ${payment.tokenOut}` : `−${payment.amount} ${payment.token || 'USDT'}`, sumClass:'out', status: { key: payment.status, text: t(statusKey) }, details: `${t('to')}: ${payment.recipient}\n${t('hash')}: ${payment.hash}`, action: payment.status === 'pending' ? { label: t('refreshStatus'), onclick: () => handlers.refreshPayments() } : undefined })); } }

  function renderRecipientHint() { const contact = model.findContact($('recipient').value); $('selected-contact-info').hidden = !contact; $('selected-contact-info').textContent = contact ? [contact.description, contact.lastPaymentAt ? `${t('lastPayment')}: ${dateText(contact.lastPaymentAt)}` : t('noPayments')].filter(Boolean).join(' · ') : ''; }

  function renderRecipientOptions() { const list = $('recipient-options'); list.replaceChildren(); const seen = new Set(); const add = (address, label) => { const value = (address || '').trim(); const key = value.toLowerCase(); if (!value || seen.has(key)) return; seen.add(key); list.append(new Option(label, value)); }; for (const contact of model.data.contacts) add(contact.address, contact.name); for (const payment of model.data.payments) if (payment.kind !== 'swap') add(payment.recipient, payment.counterparty || short(payment.recipient)); }

  function renderContacts() { const list = $('contacts-list'); list.replaceChildren(); if (!model.data.contacts.length) { const p = document.createElement('p'); p.className = 'muted'; p.textContent = t('noPayments'); list.append(p); return; } for (const contact of model.data.contacts) { const row = document.createElement('article'); row.className = 'contact-row'; const body = document.createElement('div'); const name = document.createElement('strong'); name.textContent = contact.name; const addr = document.createElement('span'); addr.className = 'mono'; addr.textContent = contact.address; body.append(name,addr); if (contact.description) { const p = document.createElement('p'); p.textContent = contact.description; body.append(p); } if (contact.lastPaymentAt) { const p = document.createElement('p'); p.textContent = `${t('lastPayment')}: ${dateText(contact.lastPaymentAt)}`; body.append(p); } const actions = document.createElement('div'); actions.className = 'contact-actions'; const choose = document.createElement('button'); choose.type = 'button'; choose.className = 'secondary'; choose.textContent = t('choose'); choose.onclick = () => handlers.chooseContact(contact); const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'text-button'; edit.textContent = t('edit'); edit.onclick = () => handlers.editContact(contact); const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'text-button danger'; remove.textContent = t('delete'); remove.onclick = () => handlers.deleteContact(contact); actions.append(choose,edit,remove); row.append(body,actions); list.append(row); } }

  function matchingPassword(firstId, secondId) { const first = $(firstId), second = $(secondId); if (first.value !== second.value) { second.setCustomValidity(t('passwordMismatch')); second.reportValidity(); second.addEventListener('input', () => second.setCustomValidity(''), { once:true }); return null; } return first.value; }

  function renderPrivacy() {
    const hidden = model.data.ui.privacy;
    document.body.classList.toggle('privacy', hidden);
    setIcon($('eye-toggle'), hidden ? 'eye-slash' : 'eye');
    $('eye-toggle').title = t(hidden ? 'showBalance' : 'hideBalance');
  }

  function renderPaymentSummary() {
    const draft = model.data.ui.paymentDraft;
    if (!draft) { $('payment-dialog-summary').textContent = ''; return; }
    if (draft.kind === 'swap') {
      const quote = model.data.swapQuoteData;
      $('payment-dialog-summary').textContent = quote ? `${quote.amountIn} ${quote.tokenIn} → ≈${quote.estimatedOut} ${quote.tokenOut}\n${t('swapMinimum')}: ${quote.minOut} ${quote.tokenOut}\n${t('from')}: ${model.activeAddress}` : '';
    } else {
      $('payment-dialog-summary').textContent = `${draft.value} ${draft.token}\n${t('from')}: ${draft.walletAddress}\n${t('to')}: ${draft.recipient}${draft.description ? `\n${t('note')}: ${draft.description}` : ''}`;
    }
  }

  function clearModalSecrets(id) {
    if (id === 'payment-password-dialog') $('payment-password').value = '';
    if (id === 'secret-dialog') $('secret-password').value = '';
    if (id === 'backup') $('backup-key').value = '';
  }

  function renderDialogs() {
    const modal = model.data.ui.modal;
    for (const dialog of document.querySelectorAll('dialog')) {
      if (dialog.id !== modal && dialog.open) { dialog.close(); clearModalSecrets(dialog.id); }
    }
    if (!modal || $(modal).open) return;
    const inputId = { 'payment-password-dialog': 'payment-password', 'secret-dialog': 'secret-password' }[modal];
    if (inputId) {
      $(inputId).value = '';
      $(inputId).name = `manual-${inputId}-${Date.now()}`;
    }
    $(modal).showModal();
    if (inputId) $(inputId).focus();
  }

  function renderTransactionStatus() {
    const result = model.data.ui.transactionStatus;
    if (!result) { $('tx-result').textContent = ''; return; }
    const status = model.data.ui.language === 'en' ? ({ 'Успешно':'Success', 'Ошибка':'Failed', 'Ожидает подтверждения или не найдена':'Pending or not found' }[result.status] || result.status) : result.status;
    $('tx-result').textContent = result.block ? `${status} · ${result.block}` : status;
  }

  function spinnerText(node, text) {
    node.textContent = text;
    node.hidden = !text;
    if (text) node.prepend(Object.assign(document.createElement('span'), { className: 'spinner' }));
  }

  function renderNotice() {
    const { notice, pending, modal } = model.data.ui;
    const progress = pending.action || pending.paymentHistory || (!['payment-password-dialog', 'secret-dialog'].includes(modal) && Object.values(pending)[0]);
    const node = $('message');
    node.className = !progress && notice.error ? 'notice error' : 'notice';
    if (progress) spinnerText(node, t(progress.label));
    else { node.textContent = notice.text; node.hidden = !notice.text; }
  }

  function renderOperations() {
    const { pending } = model.data.ui;
    document.body.setAttribute('aria-busy', String(Object.keys(pending).length > 0));
    document.querySelectorAll('button').forEach((button) => { button.disabled = model.busy; button.removeAttribute('aria-busy'); });
    $('wallet-select').disabled = model.busy;
    $('refresh-balance').disabled ||= !model.activeAddress;
    $('copy-address').disabled ||= !model.activeAddress;
    const targets = {
      inspectAddress: '#refresh-balance', inspectTron: '#refresh-balance',
      quoteSwap: '#quote-swap', listPayments: '#load-history, .refresh-btn', loadTransferHistory: '#load-history',
      transactionStatus: '#status-form button', copyPrivateKey: '#confirm-secret',
      copyWalletAddress: '#copy-address', copyTronAddress: '#copy-tron-address, #receive-copy-tron-address',
      sendToken: '#confirm-payment-button', executeSwap: '#confirm-payment-button'
    };
    for (const [name, selector] of Object.entries(targets)) {
      if (pending[name]) document.querySelectorAll(selector).forEach((button) => { button.disabled = true; button.setAttribute('aria-busy', 'true'); });
    }
    for (const [scope, id] of [['payment', 'payment-busy'], ['secret', 'secret-busy']]) {
      spinnerText($(id), pending[scope] ? t(pending[scope].label) : '');
    }
    $('payment-password-form').setAttribute('aria-busy', String(!!pending.payment));
    $('secret-form').setAttribute('aria-busy', String(!!pending.secret));
  }

  function takeValue(id) {
    const value = $(id).value;
    $(id).value = '';
    return value;
  }

  function selectRecipient(contact) {
    $('recipient').value = contact.address;
    $('recipient-name').value = contact.name || '';
    renderRecipientHint();
  }

  function editContact(contact) {
    $('contact-name').value = contact.name;
    $('contact-address').value = contact.address;
    $('contact-description').value = contact.description;
  }

  const click = (id, action) => $(id).addEventListener('click', action);
  const submit = (id, action) => $(id).addEventListener('submit', (event) => {
    event.preventDefault();
    if (!model.busy) action();
  });

  function bindNavigation(actions) {
    $('language').addEventListener('change', (event) => actions.changeLanguage(event.target.value));
    click('eye-toggle', () => actions.togglePrivacy());
    click('back-button', () => actions.showScreen('wallet'));
    document.querySelectorAll('[data-screen]').forEach((button) => button.addEventListener('click', () => actions.showScreen(button.dataset.screen)));
  }

  function bindWallet(actions) {
    $('wallet-select').addEventListener('change', (event) => actions.selectWallet(event.target.value));
    submit('wallet-form', () => actions.saveWatchWallet({ walletAddress: $('wallet-address').value, label: $('wallet-label').value }));
    submit('rename-wallet-form', () => actions.renameWallet($('rename-wallet').value));
    click('remove-wallet', () => actions.removeWallet());
    click('refresh-balance', () => actions.refreshBalances());
    click('copy-address', () => actions.copyAddress('ethereum'));
    click('copy-tron-address', () => actions.copyAddress('tron'));
    click('receive-copy-tron-address', () => actions.copyAddress('tron'));
    click('balance-receive', () => actions.openReceive());
    click('receive-toggle', () => actions.openReceive());
    click('receive-close', () => actions.closeModal('receive-dialog'));
  }

  function bindSwap(actions) {
    $('swap-token').addEventListener('change', () => { actions.resetSwap(); renderSwapBalance(); });
    $('swap-amount').addEventListener('input', () => actions.resetSwap());
    submit('swap-form', () => actions.quoteSwap({ tokenIn: $('swap-token').value, value: $('swap-amount').value }));
    click('swap-continue', () => actions.continueSwap());
  }

  function bindContacts(actions) {
    $('recipient').addEventListener('input', renderRecipientHint);
    submit('contact-form', () => actions.saveContact({ name: $('contact-name').value, recipient: $('contact-address').value, description: $('contact-description').value }));
  }

  function bindHistory(actions) {
    click('load-history', () => actions.loadHistory());
    submit('status-form', () => actions.checkTransaction($('tx-hash').value));
  }

  function bindSettings(actions) {
    submit('infura-form', () => actions.saveInfuraKey(takeValue('infura-key')));
    submit('import-form', () => {
      const password = matchingPassword('import-password', 'import-password-confirm');
      if (password === null) return;
      const privateKey = takeValue('private-key');
      takeValue('import-password'); takeValue('import-password-confirm');
      actions.importWallet({ privateKey, password });
    });
    submit('cwg-form', () => {
      const newPassword = matchingPassword('cwg-new-password', 'cwg-new-password-confirm');
      if (newPassword === null) return;
      const encryptedKey = takeValue('cwg-key');
      const password = takeValue('cwg-password');
      takeValue('cwg-new-password'); takeValue('cwg-new-password-confirm');
      actions.importCwgKey({ encryptedKey, password, newPassword });
    });
    submit('create-form', () => {
      const password = matchingPassword('create-password', 'create-password-confirm');
      if (password === null) return;
      takeValue('create-password'); takeValue('create-password-confirm');
      actions.createWallet({ password, label: $('create-label').value });
    });
    click('delete-wallet', () => actions.deleteSigningKey());
  }

  function bindPayment(actions) {
    submit('send-form', () => actions.preparePayment({
      recipient: $('recipient').value, value: $('amount').value, token: $('payment-token').value,
      description: $('payment-description').value, contactName: $('recipient-name').value
    }));
  }

  function bindDialogs(actions) {
    click('copy-private-key', () => actions.openSecret());
    click('cancel-secret', () => actions.closeModal('secret-dialog'));
    submit('secret-form', () => actions.copyPrivateKey(takeValue('secret-password')));
    click('hide-backup', () => actions.hideBackup());
    click('cancel-payment', () => actions.closeModal('payment-password-dialog'));
    submit('payment-password-form', () => actions.confirmPayment(takeValue('payment-password')));
    for (const dialog of document.querySelectorAll('dialog')) {
      dialog.addEventListener('cancel', (event) => { event.preventDefault(); actions.cancelModal(dialog.id); });
      dialog.addEventListener('close', () => {
        if (dialog.open) return;
        clearModalSecrets(dialog.id);
        actions.closeModal(dialog.id);
      });
    }
  }

  function bindPanels(actions) {
    for (const id of Object.keys(model.data.ui.panels)) $(id).addEventListener('toggle', () => actions.setPanel(id, $(id).open));
  }

  function renderPaymentError() {
    $('payment-password-error').textContent = model.data.ui.paymentError;
    if (model.data.ui.paymentError && model.data.ui.modal === 'payment-password-dialog') $('payment-password').focus();
  }

  function renderSecretError() {
    $('secret-error').textContent = model.data.ui.secretError;
    if (model.data.ui.secretError && model.data.ui.modal === 'secret-dialog') $('secret-password').focus();
  }

  function renderPanels() {
    for (const [id, open] of Object.entries(model.data.ui.panels)) if ($(id).open !== open) $(id).open = open;
  }

  const navigationView = compose([
    observe(['ui.screen', 'ui.language'], renderScreen),
    observe(['ui.privacy', 'ui.language'], renderPrivacy)
  ], bindNavigation);

  const walletView = compose([
    observe(['state', 'ui.language'], () => { renderWallets(); renderState(); }),
    observe(['overview', 'overviewUnavailable', 'ui.language'], renderOverview),
    observe(['tronOverview', 'tronUnavailable', 'ui.language'], renderTron),
    observe(['overview', 'tronOverview', 'ui.language'], renderTotalBalance)
  ], bindWallet);

  const paymentsView = compose([
    compose([observe(['swapQuoteData', 'ui.language'], renderSwapQuote)], bindSwap),
    compose([
      observe(['contacts', 'ui.language'], () => { renderContacts(); renderRecipientHint(); }),
      observe(['contacts', 'payments', 'ui.language'], renderRecipientOptions)
    ], bindContacts)
  ], bindPayment);

  const historyView = compose([
    observe(['transfers', 'ui.language'], renderTransfers),
    observe(['payments', 'ui.language'], renderPayments),
    observe(['historyLoaded'], () => { $('history-content').hidden = !model.data.historyLoaded; }),
    observe(['ui.transactionStatus', 'ui.language'], renderTransactionStatus)
  ], bindHistory);

  const settingsView = compose([
    observe(['ui.panels'], renderPanels)
  ], (actions) => { bindSettings(actions); bindPanels(actions); });

  const dialogsView = compose([
    observe(['ui.paymentDraft', 'swapQuoteData', 'state', 'ui.language'], renderPaymentSummary),
    observe(['ui.modal'], renderDialogs),
    observe(['ui.paymentError'], renderPaymentError),
    observe(['ui.secretError'], renderSecretError)
  ], bindDialogs);

  const feedbackView = compose([
    observe(['ui.pending', 'ui.notice', 'ui.modal', 'ui.language'], renderNotice),
    observe(['ui.pending', 'state', 'contacts', 'payments', 'ui.modal', 'ui.language'], renderOperations)
  ]);

  const rootView = compose([
    observe(['ui.language'], translate),
    navigationView,
    walletView,
    paymentsView,
    historyView,
    settingsView,
    dialogsView,
    feedbackView
  ], (actions) => { handlers = actions; injectIcons(); });

  return {
    bind: rootView.bind,
    render: rootView.render,
    text: t,
    selectRecipient,
    editContact,
    resetPaymentForm() { $('send-form').reset(); },
    resetWatchWalletForm() { $('wallet-form').reset(); },
    resetContactForm() { $('contact-form').reset(); },
    clearRecipientName() { $('recipient-name').value = ''; },
    showBackupKey(key) { $('backup-key').value = key; $('create-label').value = ''; },
    applyPaymentResult(hash, kind) {
      $('tx-hash').value = hash;
      if (kind !== 'swap') { $('amount').value = ''; $('payment-description').value = ''; }
    }
  };
}
