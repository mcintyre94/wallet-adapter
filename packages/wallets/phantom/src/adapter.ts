import type { EventEmitter, SendTransactionOptions, WalletName } from '@solana/wallet-adapter-base';
import {
    BaseMessageSignerWalletAdapter,
    isVersionedTransaction,
    scopePollingDetectionStrategy,
    WalletAccountError,
    WalletConnectionError,
    WalletDisconnectedError,
    WalletDisconnectionError,
    WalletError,
    WalletNotConnectedError,
    WalletNotReadyError,
    WalletPublicKeyError,
    WalletReadyState,
    WalletSendTransactionError,
    WalletSignMessageError,
    WalletSignTransactionError,
} from '@solana/wallet-adapter-base';
import type {
    Connection,
    SendOptions,
    Transaction,
    TransactionSignature,
    TransactionVersion,
    VersionedTransaction,
} from '@solana/web3.js';
import { PublicKey } from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

interface PhantomWalletEvents {
    connect(...args: unknown[]): unknown;
    disconnect(...args: unknown[]): unknown;
    accountChanged(newPublicKey: PublicKey): unknown;
}

interface PhantomWallet extends EventEmitter<PhantomWalletEvents> {
    isPhantom?: boolean;
    publicKey?: { toBytes(): Uint8Array };
    isConnected: boolean;
    signTransaction<T extends Transaction | VersionedTransaction>(transaction: T): Promise<T>;
    signAllTransactions<T extends Transaction | VersionedTransaction>(transactions: T[]): Promise<T[]>;
    signAndSendTransaction<T extends Transaction | VersionedTransaction>(
        transaction: T,
        options?: SendOptions
    ): Promise<{ signature: TransactionSignature }>;
    signMessage(message: Uint8Array): Promise<{ signature: Uint8Array }>;
    connect(): Promise<void>;
    disconnect(): Promise<void>;
}

interface PhantomWindow extends Window {
    phantom?: {
        solana?: PhantomWallet;
    };
    solana?: PhantomWallet;
}

declare const window: PhantomWindow;

export interface PhantomWalletAdapterConfig {}

export const PhantomWalletName = 'Phantom' as WalletName<'Phantom'>;

export class PhantomWalletAdapter extends BaseMessageSignerWalletAdapter {
    name = PhantomWalletName;
    url = 'https://phantom.app';
    icon =
        'data:image/svg+xml;base64,PHN2ZyBmaWxsPSJub25lIiBoZWlnaHQ9IjM0IiB3aWR0aD0iMzQiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGxpbmVhckdyYWRpZW50IGlkPSJhIiB4MT0iLjUiIHgyPSIuNSIgeTE9IjAiIHkyPSIxIj48c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiM1MzRiYjEiLz48c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiM1NTFiZjkiLz48L2xpbmVhckdyYWRpZW50PjxsaW5lYXJHcmFkaWVudCBpZD0iYiIgeDE9Ii41IiB4Mj0iLjUiIHkxPSIwIiB5Mj0iMSI+PHN0b3Agb2Zmc2V0PSIwIiBzdG9wLWNvbG9yPSIjZmZmIi8+PHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjZmZmIiBzdG9wLW9wYWNpdHk9Ii44MiIvPjwvbGluZWFyR3JhZGllbnQ+PGNpcmNsZSBjeD0iMTciIGN5PSIxNyIgZmlsbD0idXJsKCNhKSIgcj0iMTciLz48cGF0aCBkPSJtMjkuMTcwMiAxNy4yMDcxaC0yLjk5NjljMC02LjEwNzQtNC45NjgzLTExLjA1ODE3LTExLjA5NzUtMTEuMDU4MTctNi4wNTMyNSAwLTEwLjk3NDYzIDQuODI5NTctMTEuMDk1MDggMTAuODMyMzctLjEyNDYxIDYuMjA1IDUuNzE3NTIgMTEuNTkzMiAxMS45NDUzOCAxMS41OTMyaC43ODM0YzUuNDkwNiAwIDEyLjg0OTctNC4yODI5IDEzLjk5OTUtOS41MDEzLjIxMjMtLjk2MTktLjU1MDItMS44NjYxLTEuNTM4OC0xLjg2NjF6bS0xOC41NDc5LjI3MjFjMCAuODE2Ny0uNjcwMzggMS40ODQ3LTEuNDkwMDEgMS40ODQ3LS44MTk2NCAwLTEuNDg5OTgtLjY2ODMtMS40ODk5OC0xLjQ4NDd2LTIuNDAxOWMwLS44MTY3LjY3MDM0LTEuNDg0NyAxLjQ4OTk4LTEuNDg0Ny44MTk2MyAwIDEuNDkwMDEuNjY4IDEuNDkwMDEgMS40ODQ3em01LjE3MzggMGMwIC44MTY3LS42NzAzIDEuNDg0Ny0xLjQ4OTkgMS40ODQ3LS44MTk3IDAtMS40OS0uNjY4My0xLjQ5LTEuNDg0N3YtMi40MDE5YzAtLjgxNjcuNjcwNi0xLjQ4NDcgMS40OS0xLjQ4NDcuODE5NiAwIDEuNDg5OS42NjggMS40ODk5IDEuNDg0N3oiIGZpbGw9InVybCgjYikiLz48L3N2Zz4K';
    supportedTransactionVersions: ReadonlySet<TransactionVersion> = new Set(['legacy', 0]);

    private _connecting: boolean;
    private _wallet: PhantomWallet | null;
    private _publicKey: PublicKey | null;
    private _readyState: WalletReadyState =
        typeof window === 'undefined' || typeof document === 'undefined'
            ? WalletReadyState.Unsupported
            : WalletReadyState.NotDetected;

    private _deepLinkPublicKeyStorage = 'PHANTOM_DEEP_LINK_PUBLIC_KEY';
    private _deepLinkSecretKeyStorage = 'PHANTOM_DEEP_LINK_SECRET_KEY';
    private _deepLinkSharedSecretStorage = 'PHANTOM_DEEP_LINK_SHARED_SECRET';
    private _deepLinkSessionStorage = 'PHANTOM_DEEP_LINK_SESSION';

    constructor(config: PhantomWalletAdapterConfig = {}) {
        super();
        this._connecting = false;
        this._wallet = null;
        this._publicKey = null;

        if (this._readyState !== WalletReadyState.Unsupported) {
            // TODO: only do this on iOS + not webview
            const useDeepLink = true;
            if (useDeepLink) {
                this._readyState = WalletReadyState.Loadable;
                this.emit('readyStateChange', this._readyState);
            } else {
                scopePollingDetectionStrategy(() => {
                    if (window.phantom?.solana?.isPhantom || window.solana?.isPhantom) {
                        this._readyState = WalletReadyState.Installed;
                        this.emit('readyStateChange', this._readyState);
                        return true;
                    }
                    return false;
                });
            }
        }
    }

    get publicKey() {
        return this._publicKey;
    }

    get connecting() {
        return this._connecting;
    }

    get connected() {
        return !!this._wallet?.isConnected;
    }

    get readyState() {
        return this._readyState;
    }

    private localStorageSet(key: string, value: string) {
        localStorage.setItem(key, value.toString());
    }

    private localStorageGetUint8(key: string): Uint8Array {
        const valueString = localStorage.getItem(key);
        if (!valueString) {
            // error
            const error = new WalletError(`Key ${key} not stored`);
            this.emit('error', error);
            throw error;
        }

        return Uint8Array.from(valueString.split(',').map(Number));
    }

    private makeRedirectUrl() {
        const url = new URL(window.location.href);
        // Strip Phantom query params
        url.searchParams.delete('phantom_encryption_public_key');
        url.searchParams.delete('nonce');
        url.searchParams.delete('data');
        url.searchParams.delete('errorCode');
        url.searchParams.delete('errorMessage');
        return url.toString();
    }

    private makeDeepLinkUrl(path: string, params: URLSearchParams) {
        return `https://phantom.app/ul/v1/${path}?${params.toString()}`;
    }

    private async connectUsingDeepLink(): Promise<void> {
        const dappDeepLinkKeypair = nacl.box.keyPair();

        this.localStorageSet(this._deepLinkPublicKeyStorage, dappDeepLinkKeypair.publicKey.toString());
        this.localStorageSet(this._deepLinkSecretKeyStorage, dappDeepLinkKeypair.secretKey.toString());

        const appUrl = this.makeRedirectUrl();
        const connectUrl = this.makeDeepLinkUrl(
            'connect',
            new URLSearchParams({
                app_url: appUrl,
                dapp_encryption_public_key: bs58.encode(dappDeepLinkKeypair.publicKey),
                redirect_link: appUrl,
                cluster: 'devnet', // TODO: pass this in
            })
        );

        alert(connectUrl);

        window.location.href = connectUrl;
    }

    private handleConnectionDeepLinkParams(phantomEncryptionPublicKey: string, nonce: string, encryptedData: string) {
        const dappSecretKey = this.localStorageGetUint8(this._deepLinkSecretKeyStorage);
        const phantomPublicKey = bs58.decode(phantomEncryptionPublicKey);

        const sharedSecret = nacl.box.before(phantomPublicKey, dappSecretKey);
        this.localStorageSet(this._deepLinkSharedSecretStorage, sharedSecret.toString());

        const decrypytedConnectData = nacl.box.open.after(bs58.decode(encryptedData), bs58.decode(nonce), sharedSecret);

        if (!decrypytedConnectData) {
            const error = new WalletConnectionError('Unable to decrypt connection params');
            this.emit('error', error);
            throw error;
        }

        const parsedConnectData = JSON.parse(Buffer.from(decrypytedConnectData).toString('utf8'));

        const walletPublicKey: string = parsedConnectData.public_key;
        const session: string = parsedConnectData.session;

        localStorage.setItem(this._deepLinkSessionStorage, session);

        this._publicKey = new PublicKey(walletPublicKey);
        this.emit('connect', this._publicKey);
    }

    async connect(): Promise<void> {
        try {
            if (this.connected || this.connecting || !window) return;
            if (this._readyState !== WalletReadyState.Installed && this._readyState !== WalletReadyState.Loadable)
                throw new WalletNotReadyError();

            this._connecting = true;

            if (this._readyState === WalletReadyState.Loadable) {
                // Check the URL for Phantom deeplink params
                const urlParams = new URLSearchParams(window.location.search);
                const phantomEncryptionPublicKey = urlParams.get('phantom_encryption_public_key');
                const nonce = urlParams.get('nonce');
                const data = urlParams.get('data');

                console.log({ phantomEncryptionPublicKey, nonce, data });

                if (phantomEncryptionPublicKey && nonce && data) {
                    this.handleConnectionDeepLinkParams(phantomEncryptionPublicKey, nonce, data);
                } else {
                    this.connectUsingDeepLink();
                }
            } else {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                const wallet = window.phantom?.solana || window.solana!;

                if (!wallet.isConnected) {
                    try {
                        await wallet.connect();
                    } catch (error: any) {
                        throw new WalletConnectionError(error?.message, error);
                    }
                }

                if (!wallet.publicKey) throw new WalletAccountError();

                let publicKey: PublicKey;
                try {
                    publicKey = new PublicKey(wallet.publicKey.toBytes());
                } catch (error: any) {
                    throw new WalletPublicKeyError(error?.message, error);
                }

                wallet.on('disconnect', this._disconnected);
                wallet.on('accountChanged', this._accountChanged);

                this._wallet = wallet;
                this._publicKey = publicKey;

                this.emit('connect', publicKey);
            }
        } catch (error: any) {
            this.emit('error', error);
            throw error;
        } finally {
            this._connecting = false;
        }
    }

    async disconnect(): Promise<void> {
        const wallet = this._wallet;
        if (wallet) {
            wallet.off('disconnect', this._disconnected);
            wallet.off('accountChanged', this._accountChanged);

            this._wallet = null;
            this._publicKey = null;

            try {
                await wallet.disconnect();
            } catch (error: any) {
                this.emit('error', new WalletDisconnectionError(error?.message, error));
            }
        }

        this.emit('disconnect');
    }

    private async signAndPrepareTransaction<T extends Transaction | VersionedTransaction>(
        transaction: T,
        connection: Connection,
        options: SendTransactionOptions = {}
    ): Promise<{ transaction: T; sendOptions: SendTransactionOptions }> {
        try {
            const { signers, ...sendOptions } = options;

            if (isVersionedTransaction(transaction)) {
                signers?.length && transaction.sign(signers);
            } else {
                transaction = (await this.prepareTransaction(transaction, connection, sendOptions)) as T;
                signers?.length && (transaction as Transaction).partialSign(...signers);
            }

            return { transaction, sendOptions };
        } catch (error: any) {
            if (error instanceof WalletError) throw error;
            throw new WalletSendTransactionError(error?.message, error);
        }
    }

    private async sendTransactionUsingDeepLink<T extends Transaction | VersionedTransaction>(
        transaction: T,
        connection: Connection,
        options: SendTransactionOptions = {}
    ) {
        const { transaction: preparedTransaction, sendOptions } = await this.signAndPrepareTransaction(
            transaction,
            connection,
            options
        );

        const dappPublicKey = this.localStorageGetUint8(this._deepLinkPublicKeyStorage);
        const sharedSecret = this.localStorageGetUint8(this._deepLinkSharedSecretStorage);
        const session = localStorage.getItem(this._deepLinkSessionStorage);

        const nonce = nacl.randomBytes(24);

        const serializedTransaction = preparedTransaction.serialize({
            requireAllSignatures: false,
        });

        const payload = {
            transaction: bs58.encode(serializedTransaction),
            sendOptions,
            session,
        };

        const encryptedPayload = nacl.box.after(Buffer.from(JSON.stringify(payload)), nonce, sharedSecret);

        const sendTransactionUrl = this.makeDeepLinkUrl(
            'signAndSendTransaction',
            new URLSearchParams({
                dapp_encryption_public_key: bs58.encode(dappPublicKey),
                nonce: bs58.encode(nonce),
                redirect_link: this.makeRedirectUrl(),
                payload: bs58.encode(encryptedPayload),
            })
        );

        window.location.href = sendTransactionUrl;
        return 'TransactionSignature';
    }

    async sendTransaction<T extends Transaction | VersionedTransaction>(
        transaction: T,
        connection: Connection,
        options: SendTransactionOptions = {}
    ): Promise<TransactionSignature> {
        try {
            if (this.readyState === WalletReadyState.Loadable) {
                return this.sendTransactionUsingDeepLink(transaction, connection, options);
            } else {
                const wallet = this._wallet;
                if (!wallet) throw new WalletNotConnectedError();

                try {
                    const { transaction: preparedTransaction, sendOptions } = await this.signAndPrepareTransaction(
                        transaction,
                        connection,
                        options
                    );
                    sendOptions.preflightCommitment = sendOptions.preflightCommitment || connection.commitment;

                    const { signature } = await wallet.signAndSendTransaction(preparedTransaction, sendOptions);
                    return signature;
                } catch (error: any) {
                    if (error instanceof WalletError) throw error;
                    throw new WalletSendTransactionError(error?.message, error);
                }
            }
        } catch (error: any) {
            this.emit('error', error);
            throw error;
        }
    }

    async signTransaction<T extends Transaction | VersionedTransaction>(transaction: T): Promise<T> {
        try {
            const wallet = this._wallet;
            if (!wallet) throw new WalletNotConnectedError();

            try {
                return (await wallet.signTransaction(transaction)) || transaction;
            } catch (error: any) {
                throw new WalletSignTransactionError(error?.message, error);
            }
        } catch (error: any) {
            this.emit('error', error);
            throw error;
        }
    }

    async signAllTransactions<T extends Transaction | VersionedTransaction>(transactions: T[]): Promise<T[]> {
        try {
            const wallet = this._wallet;
            if (!wallet) throw new WalletNotConnectedError();

            try {
                return (await wallet.signAllTransactions(transactions)) || transactions;
            } catch (error: any) {
                throw new WalletSignTransactionError(error?.message, error);
            }
        } catch (error: any) {
            this.emit('error', error);
            throw error;
        }
    }

    async signMessage(message: Uint8Array): Promise<Uint8Array> {
        try {
            const wallet = this._wallet;
            if (!wallet) throw new WalletNotConnectedError();

            try {
                const { signature } = await wallet.signMessage(message);
                return signature;
            } catch (error: any) {
                throw new WalletSignMessageError(error?.message, error);
            }
        } catch (error: any) {
            this.emit('error', error);
            throw error;
        }
    }

    private _disconnected = () => {
        const wallet = this._wallet;
        if (wallet) {
            wallet.off('disconnect', this._disconnected);
            wallet.off('accountChanged', this._accountChanged);

            this._wallet = null;
            this._publicKey = null;

            this.emit('error', new WalletDisconnectedError());
            this.emit('disconnect');
        }
    };

    private _accountChanged = (newPublicKey: PublicKey) => {
        const publicKey = this._publicKey;
        if (!publicKey) return;

        try {
            newPublicKey = new PublicKey(newPublicKey.toBytes());
        } catch (error: any) {
            this.emit('error', new WalletPublicKeyError(error?.message, error));
            return;
        }

        if (publicKey.equals(newPublicKey)) return;

        this._publicKey = newPublicKey;
        this.emit('connect', newPublicKey);
    };
}
