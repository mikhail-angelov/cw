const walletView = createWalletViews(walletModel);
const walletController = createWalletControllers(walletModel, walletView, tiny);

walletView.bind(walletController);
walletModel.subscribe((_snapshot, changed) => walletView.render(changed));
walletView.render();
walletController.start();
