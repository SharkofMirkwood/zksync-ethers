import { ethers, AbstractSigner, BlockTag, SigningKey } from "ethers";
import { Provider } from "./provider";
import {
    TransactionResponse,
    TransactionRequest,
    TransactionLike,
    SmartAccountSinger,
    TransactionSigner,
    TransactionBuilder,
    MessageSigner,
    TypedDataSigner,
    Address,
    BalancesMap,
} from "./types";

import {
    signTransaction,
    signMessage,
    populateTransaction,
    signTypedData,
    signTransactionMultisig,
    signMessageMultisig,
    signTypedDataMultisig,
    populateTransactionMultisig,
} from "./smart-account-utils";
import { INonceHolder__factory } from "../typechain";
import { NONCE_HOLDER_ADDRESS } from "./utils";

function checkProvider(signer: SmartAccount, operation: string): Provider {
    if (signer.provider) {
        return signer.provider;
    }
    ethers.assert(false, "missing provider", "UNSUPPORTED_OPERATION", { operation });
}

/**
 * A `SmartAccount` is a signer which can be configured to sign various payloads using a provided secret.
 * The secret can be in any form, allowing for flexibility when working with different account implementations.
 * The `SmartAccount` is bound to a specific address and provides the ability to define custom signing methods
 * for messages, typed data, and transactions. It is compatible with {@link ethers.ContractFactory} for deploying
 * contracts/accounts, as well as with {@link ethers.Contract} for interacting with contracts/accounts using provided
 * ABI along with custom transaction signing logic.
 */
export class SmartAccount extends AbstractSigner {
    readonly address!: string;
    readonly secret: any;
    override readonly provider!: null | Provider;

    protected transactionSigner: TransactionSigner;
    protected messageSigner: MessageSigner;
    protected typedDataSigner: TypedDataSigner;
    protected transactionBuilder: TransactionBuilder;

    constructor(signer: SmartAccountSinger, provider: null | Provider) {
        super(provider);
        ethers.defineProperties<SmartAccount>(this, {
            address: signer.address,
            secret: signer.secret,
        });
        this.transactionSigner = signer.transactionSigner || signTransaction;
        this.messageSigner = signer.messageSigner || signMessage;
        this.transactionBuilder = signer.transactionBuilder || populateTransaction;
        this.typedDataSigner = signer.typedDataSigner || signTypedData;
    }

    /**
     * Creates a new instance of SmartAccount connected to a provider or detached
     * from any provider if `null` is provided.
     *
     * @param provider - The provider to connect the SmartAccount to.
     * If `null`, the SmartAccount will be detached from any provider.
     */
    connect(provider: null | Provider): SmartAccount {
        return new SmartAccount(
            {
                address: this.address,
                secret: this.secret,
                transactionSigner: this.transactionSigner,
                messageSigner: this.messageSigner,
                transactionBuilder: this.transactionBuilder,
                typedDataSigner: this.typedDataSigner,
            },
            provider,
        );
    }

    /**
     * Returns the address of the account.
     */
    getAddress(): Promise<string> {
        return Promise.resolve(this.address);
    }

    /**
     * Returns the balance of the account.
     *
     * @param [token] - Optional: The token address to query balance for. Defaults to the native token.
     * @param [blockTag='committed'] - Optional: The block tag to get the balance at. Defaults to `committed`.
     */
    async getBalance(token?: Address, blockTag: BlockTag = "committed"): Promise<bigint> {
        return await checkProvider(this, "getBalance").getBalance(
            await this.getAddress(),
            blockTag,
            token,
        );
    }

    /**
     * Returns all token balances of the account.
     */
    async getAllBalances(): Promise<BalancesMap> {
        return await checkProvider(this, "getAllAccountBalances").getAllAccountBalances(
            await this.getAddress(),
        );
    }

    /**
     * Returns the deployment nonce of the account.
     */
    async getDeploymentNonce(): Promise<bigint> {
        return await INonceHolder__factory.connect(NONCE_HOLDER_ADDRESS, this).getDeploymentNonce(
            await this.getAddress(),
        );
    }

    /**
     * Populates the transaction `tx` using the provided {@link TransactionBuilder} function.
     * If `tx.from` is not set, it sets the value from the `SmartAccount.getAddress()` method.
     */
    override async populateTransaction(tx: ethers.TransactionRequest): Promise<TransactionLike> {
        return this.transactionBuilder(
            {
                ...tx,
                from: tx.from || (await this.getAddress()),
            },
            this.secret,
            this.provider,
        );
    }

    /**
     * Signs the transaction `tx` using the provided {@link TransactionSigner} function,
     * returning the fully signed transaction.The `SmartAccount.populateTransaction(tx)`
     * method is called first to ensure that all necessary properties for the transaction to be valid
     * have been populated.
     */
    async signTransaction(tx: TransactionRequest): Promise<string> {
        const populatedTx = await this.populateTransaction(tx);
        return this.transactionSigner(populatedTx, this.secret, this.provider);
    }

    /**
     *  Sends `tx` to the Network. The `SmartAccount.signTransaction(tx)`
     *  is called first to ensure transaction is properly signed.
     */
    override async sendTransaction(tx: TransactionRequest): Promise<TransactionResponse> {
        return checkProvider(this, "broadcastTransaction").broadcastTransaction(
            await this.signTransaction(tx),
        );
    }

    /**
     *  Signs a `message` using the provided {@link MessageSigner} function.
     */
    signMessage(message: string | Uint8Array): Promise<string> {
        return this.messageSigner(message, this.secret, this.provider);
    }

    /**
     *  Signs a typed data using the provided {@link TypedDataSigner} function.
     */
    signTypedData(
        domain: ethers.TypedDataDomain,
        types: Record<string, ethers.TypedDataField[]>,
        value: Record<string, any>,
    ): Promise<string> {
        return this.typedDataSigner(domain, types, value, this.secret, this.provider);
    }
}

/**
 * Creates a `SmartAccount` instance that uses a single ECDSA key for signing payload.
 */
export class ECDSASmartAccount {
    static create(address: string, secret: string | SigningKey, provider: Provider): SmartAccount {
        return new SmartAccount({ address, secret }, provider);
    }
}

/**
 * Creates a `SmartAccount` instance that uses multiple ECDSA keys for signing payloads.
 * The signature is generated by concatenating signatures created by signing each key individually.
 * The length of the resulting signature should be `secrets.length * 65`.
 */
export class MultisigECDSASmartAccount {
    static create(address: string, secret: string[] | SigningKey[], provider: Provider): SmartAccount {
        return new SmartAccount(
            {
                address,
                secret,
                transactionSigner: signTransactionMultisig,
                messageSigner: signMessageMultisig,
                typedDataSigner: signTypedDataMultisig,
                transactionBuilder: populateTransactionMultisig,
            },
            provider,
        );
    }
}
