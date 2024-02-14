import {
    ethers,
    AbstractSigner,
    BlockTag,
    SigningKey,
    hashMessage,
    TypedDataEncoder,
    BigNumberish,
} from "ethers";
import { Provider } from "./provider";
import {
    TransactionResponse,
    TransactionRequest,
    TransactionLike,
    SmartAccountSinger,
    TransactionBuilder,
    Address,
    BalancesMap,
    PayloadSigner,
    PaymasterParams,
} from "./types";

import {
    populateTransaction,
    populateTransactionMultisig,
    signPayloadWithECDSA,
    signPayloadWithMultipleECDSA,
} from "./smart-account-utils";
import { INonceHolder__factory } from "../typechain";
import { NONCE_HOLDER_ADDRESS, serializeEip712 } from "./utils";
import { EIP712Signer } from "./signer";

function checkProvider(signer: SmartAccount, operation: string): Provider {
    if (signer.provider) {
        return signer.provider;
    }
    ethers.assert(false, "missing provider", "UNSUPPORTED_OPERATION", { operation });
}

/**
 * A `SmartAccount` is a signer which can be configured to sign various payloads using a provided secret.
 * The secret can be in any form, allowing for flexibility when working with different account implementations.
 * The `SmartAccount` is bound to a specific address and provides the ability to define custom method for populating transactions
 * and custom signing method used for signing messages, typed data, and transactions.
 * It is compatible with {@link ethers.ContractFactory} for deploying contracts/accounts, as well as with {@link ethers.Contract}
 * for interacting with contracts/accounts using provided ABI along with custom transaction signing logic.
 */
export class SmartAccount extends AbstractSigner {
    /** Address to which the `SmartAccount` is bound. */
    readonly address!: string;
    /** Secret in any form that can be used for signing different payloads. */
    readonly secret: any;
    /** Provider to which the `SmartAccount` is connected. */
    override readonly provider!: null | Provider;

    /** Custom method for signing different payloads. */
    protected payloadSigner: PayloadSigner;

    /** Custom method for populating transaction requests. */
    protected transactionBuilder: TransactionBuilder;

    /**
     * @param signer - Contains necessary properties for signing payloads.
     * @param provider - The provider to connect to. Can be `null` for offline usage.
     */
    constructor(signer: SmartAccountSinger, provider: null | Provider) {
        super(provider);
        ethers.defineProperties<SmartAccount>(this, {
            address: signer.address,
            secret: signer.secret,
        });
        this.payloadSigner = signer.payloadSigner || signPayloadWithECDSA;
        this.transactionBuilder = signer.transactionBuilder || populateTransaction;
    }

    /**
     * Creates a new instance of `SmartAccount` connected to a provider or detached
     * from any provider if `null` is provided.
     *
     * @param provider - The provider to connect the `SmartAccount` to.
     * If `null`, the `SmartAccount` will be detached from any provider.
     */
    connect(provider: null | Provider): SmartAccount {
        return new SmartAccount(
            {
                address: this.address,
                secret: this.secret,
                payloadSigner: this.payloadSigner,
                transactionBuilder: this.transactionBuilder,
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
     * @param [token] - The token address to query balance for. Defaults to the native token.
     * @param [blockTag='committed'] - The block tag to get the balance at.
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
     * Signs the transaction `tx` using the provided {@link PayloadSigner} function,
     * returning the fully signed transaction.The `SmartAccount.populateTransaction(tx)`
     * method is called first to ensure that all necessary properties for the transaction to be valid
     * have been populated.
     */
    async signTransaction(tx: TransactionRequest): Promise<string> {
        const populatedTx = await this.populateTransaction(tx);
        const populatedTxHash = EIP712Signer.getSignedDigest(populatedTx);

        populatedTx.customData = {
            ...populatedTx.customData,
            customSignature: await this.payloadSigner(populatedTxHash, this.secret, this.provider),
        };
        return serializeEip712(populatedTx);
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
     *  Signs a `message` using the provided {@link PayloadSigner} function.
     */
    signMessage(message: string | Uint8Array): Promise<string> {
        return this.payloadSigner(hashMessage(message), this.secret, this.provider);
    }

    /**
     *  Signs a typed data using the provided {@link PayloadSigner} function.
     */
    async signTypedData(
        domain: ethers.TypedDataDomain,
        types: Record<string, ethers.TypedDataField[]>,
        value: Record<string, any>,
    ): Promise<string> {
        const populated = await TypedDataEncoder.resolveNames(
            domain,
            types,
            value,
            async (name: string) => {
                return ethers.resolveAddress(name, this.provider);
            },
        );

        return this.payloadSigner(
            TypedDataEncoder.hash(populated.domain, types, populated.value),
            this.secret,
            this.provider,
        );
    }

    /**
     * Initiates the withdrawal process which withdraws ETH or any ERC20 token
     * from the associated account on L2 network to the target account on L1 network.
     *
     * @param transaction - Withdrawal transaction request.
     * @param transaction.token - The address of the token. ETH by default.
     * @param transaction.amount - The amount of the token to withdraw.
     * @param [transaction.to] - The address of the recipient on L1.
     * @param [transaction.bridgeAddress] - The address of the bridge contract to be used.
     * @param [transaction.paymasterParams] - Paymaster parameters.
     * @param [transaction.overrides] - Transaction's overrides which may be used to pass l2 gasLimit, gasPrice, value, etc.
     *
     * @returns A Promise resolving to a withdrawal transaction response.
     */
    async withdraw(transaction: {
        token: Address;
        amount: BigNumberish;
        to?: Address;
        bridgeAddress?: Address;
        paymasterParams?: PaymasterParams;
        overrides?: ethers.Overrides;
    }): Promise<TransactionResponse> {
        const withdrawTx = await checkProvider(this, "getWithdrawTx").getWithdrawTx({
            from: await this.getAddress(),
            ...transaction,
        });
        return (await this.sendTransaction(withdrawTx)) as TransactionResponse;
    }

    /**
     * Transfer ETH or any ERC20 token within the same interface.
     *
     * @param transaction - Transfer transaction request.
     * @param transaction.to - The address of the recipient.
     * @param transaction.amount - The address of the recipient.
     * @param [transaction.token] - The address of the recipient.
     * @param [transaction.paymasterParams] - The address of the recipient.
     * @param [transaction.overrides] - The address of the recipient.
     *
     * @returns A Promise resolving to a transfer transaction response.
     */
    async transfer(transaction: {
        to: Address;
        amount: BigNumberish;
        token?: Address;
        paymasterParams?: PaymasterParams;
        overrides?: ethers.Overrides;
    }): Promise<TransactionResponse> {
        const transferTx = await checkProvider(this, "getTransferTx").getTransferTx({
            from: await this.getAddress(),
            ...transaction,
        });
        return (await this.sendTransaction(transferTx)) as TransactionResponse;
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
 * The signature is generated by concatenating signatures created by signing with each key individually.
 */
export class MultisigECDSASmartAccount {
    static create(address: string, secret: string[] | SigningKey[], provider: Provider): SmartAccount {
        return new SmartAccount(
            {
                address,
                secret,
                payloadSigner: signPayloadWithMultipleECDSA,
                transactionBuilder: populateTransactionMultisig,
            },
            provider,
        );
    }
}
