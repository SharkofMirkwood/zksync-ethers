import { EIP712Signer } from "./signer";
import { Provider } from "./provider";
import { EIP712_TX_TYPE, serializeEip712 } from "./utils";
import {
    ethers,
    ProgressCallback,
    AbstractSigner,
    assert,
    assertArgument,
    resolveProperties,
    resolveAddress,
    getBigInt,
    copyRequest
} from "ethers";
import { TransactionLike, TransactionRequest, TransactionResponse } from "./types";
import { AdapterL1, AdapterL2 } from "./adapters";

export class Wallet extends AdapterL2(AdapterL1(ethers.Wallet)) {
    // @ts-ignore
    override readonly provider: Provider;
    providerL1?: ethers.Provider;
    // @ts-ignore
    public eip712: EIP712Signer;

    override _providerL1() {
        if (this.providerL1 == null) {
            throw new Error("L1 provider missing: use `connectToL1` to specify");
        }
        return this.providerL1;
    }

    override _providerL2() {
        return this.provider;
    }

    override _signerL1() {
        return this.ethWallet();
    }

    override _signerL2() {
        return this;
    }

    ethWallet(): ethers.Wallet {
        return new ethers.Wallet(this.signingKey, this._providerL1());
    }

    override connect(provider: Provider): Wallet {
        return new Wallet(this.signingKey, provider, this.providerL1);
    }

    connectToL1(provider: ethers.Provider): Wallet {
        return new Wallet(this.signingKey, this.provider, provider);
    }

    static fromMnemonic(mnemonic: string, provider?: ethers.Provider): Wallet {
        const wallet = super.fromPhrase(mnemonic, provider);
        return new Wallet(wallet.signingKey, undefined, wallet.provider as ethers.Provider);
    }

    static override async fromEncryptedJson(
        json: string,
        password: string | Uint8Array,
        callback?: ProgressCallback,
    ): Promise<Wallet> {
        const wallet = await super.fromEncryptedJson(json, password, callback);
        return new Wallet(wallet.signingKey);
    }

    static override fromEncryptedJsonSync(json: string, password: string | Uint8Array): Wallet {
        const wallet = super.fromEncryptedJsonSync(json, password);
        return new Wallet(wallet.signingKey);
    }

    constructor(
        privateKey: string | ethers.SigningKey,
        providerL2?: Provider,
        providerL1?: ethers.Provider,
    ) {
        super(privateKey, providerL2);
        // @ts-ignore
        if (this.provider != null) {
            const network = this.provider.getNetwork();
            // @ts-ignore
            this.eip712 = new EIP712Signer(
                this,
                network.then((n) => Number(n.chainId)),
            );
        }
        this.providerL1 = providerL1;
    }

    // this method is copied from abstract-signer.ts in order to remove checks that does not work
    // with account abstraction.
    async _populateTransaction(tx: TransactionRequest): Promise<ethers.TransactionLike<string>> {
        const provider = checkProvider(this, "populateTransaction");

        const pop = await populate(this, tx);

        if (pop.nonce == null) {
            pop.nonce = await this.getNonce("pending");
        }

        if (pop.gasLimit == null) {
            pop.gasLimit = await this.estimateGas(pop);
        }

        // Populate the chain ID
        const network = await (<Provider>(this.provider)).getNetwork();
        if (pop.chainId != null) {
            const chainId = getBigInt(pop.chainId);
            assertArgument(chainId === network.chainId, "transaction chainId mismatch", "tx.chainId", tx.chainId);
        } else {
            pop.chainId = network.chainId;
        }

        // Do not allow mixing pre-eip-1559 and eip-1559 properties
        const hasEip1559 = (pop.maxFeePerGas != null || pop.maxPriorityFeePerGas != null);
        if (pop.gasPrice != null && (pop.type === 2 || hasEip1559)) {
            assertArgument(false, "eip-1559 transaction do not support gasPrice", "tx", tx);
        } else if ((pop.type === 0 || pop.type === 1) && hasEip1559) {
            assertArgument(false, "pre-eip-1559 transaction do not support maxFeePerGas/maxPriorityFeePerGas", "tx", tx);
        }

        if ((pop.type === 2 || pop.type == null) && (pop.maxFeePerGas != null && pop.maxPriorityFeePerGas != null)) {
            // Fully-formed EIP-1559 transaction (skip getFeeData)
            pop.type = 2;

        } else if (pop.type === 0 || pop.type === 1) {
            // Explicit Legacy or EIP-2930 transaction

            // We need to get fee data to determine things
            const feeData = await provider.getFeeData();

            assert(feeData.gasPrice != null, "network does not support gasPrice", "UNSUPPORTED_OPERATION", {
                operation: "getGasPrice" });

            // Populate missing gasPrice
            if (pop.gasPrice == null) { pop.gasPrice = feeData.gasPrice; }

        } else {

            // We need to get fee data to determine things
            const feeData = await provider.getFeeData();

            if (pop.type == null) {
                // We need to auto-detect the intended type of this transaction...

                if (feeData.maxFeePerGas != null && feeData.maxPriorityFeePerGas != null) {
                    // The network supports EIP-1559!

                    // Upgrade transaction from null to eip-1559
                    pop.type = 2;

                    if (pop.gasPrice != null) {
                        // Using legacy gasPrice property on an eip-1559 network,
                        // so use gasPrice as both fee properties
                        const gasPrice = pop.gasPrice;
                        delete pop.gasPrice;
                        pop.maxFeePerGas = gasPrice;
                        pop.maxPriorityFeePerGas = gasPrice;

                    } else {
                        // Populate missing fee data

                        if (pop.maxFeePerGas == null) {
                            pop.maxFeePerGas = feeData.maxFeePerGas;
                        }

                        if (pop.maxPriorityFeePerGas == null) {
                            pop.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
                        }
                    }

                } else if (feeData.gasPrice != null) {
                    // Network doesn't support EIP-1559...

                    // ...but they are trying to use EIP-1559 properties
                    assert(!hasEip1559, "network does not support EIP-1559", "UNSUPPORTED_OPERATION", {
                        operation: "populateTransaction" });

                    // Populate missing fee data
                    if (pop.gasPrice == null) {
                        pop.gasPrice = feeData.gasPrice;
                    }

                    // Explicitly set untyped transaction to legacy
                    pop.type = 0;

                } else {
                    // getFeeData has failed us.
                    assert(false, "failed to get consistent fee data", "UNSUPPORTED_OPERATION", {
                        operation: "signer.getFeeData" });
                }

            } else if (pop.type === 2) {
                // Explicitly using EIP-1559

                // Populate missing fee data
                if (pop.maxFeePerGas == null) {
                    pop.maxFeePerGas = feeData.maxFeePerGas;
                }

                if (pop.maxPriorityFeePerGas == null) {
                    pop.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
                }
            }
        }

        return await resolveProperties(pop);
    }

    override async populateCall(tx: TransactionRequest): Promise<ethers.TransactionLike<string>> {
        return await populate(this, tx);
    }

    override async populateTransaction(transaction: TransactionRequest): Promise<TransactionLike> {
        if (transaction.type == null && transaction.customData == null) {
            // use legacy txs by default
            transaction.type = 0;
        }
        if (transaction.customData == null && transaction.type != EIP712_TX_TYPE) {
            return (await super.populateTransaction(transaction)) as TransactionLike;
        }
        const populated = (await this._populateTransaction(transaction)) as TransactionLike;

        populated.type = EIP712_TX_TYPE;
        populated.value ??= 0;
        populated.data ??= "0x";
        populated.customData = this._fillCustomData(transaction.customData ?? {});
        populated.gasPrice = await this.provider.getGasPrice();
        return populated;
    }

    override async signTransaction(transaction: TransactionRequest): Promise<string> {
        if (transaction.customData == null && transaction.type != EIP712_TX_TYPE) {
            if (transaction.type == 2 && transaction.maxFeePerGas == null) {
                transaction.maxFeePerGas = await this.provider.getGasPrice();
            }
            return await super.signTransaction(transaction);
        } else {
            transaction.from ??= this.address;
            transaction.customData ??= {};
            const populated = await this.populateTransaction(transaction);
            // @ts-ignore
            populated.customData.customSignature = await this.eip712.sign(populated);

            return serializeEip712(populated);
        }
    }

    override async sendTransaction(tx: TransactionRequest): Promise<TransactionResponse> {
        const populatedTx = await this.populateTransaction(tx);
        return await this.provider.broadcastTransaction(await this.signTransaction(populatedTx));
    }
}

function checkProvider(signer: AbstractSigner, operation: string): ethers.Provider {
    if (signer.provider) { return signer.provider; }
    assert(false, "missing provider", "UNSUPPORTED_OPERATION", { operation });
}

async function populate(signer: AbstractSigner, tx: TransactionRequest): Promise<ethers.TransactionLike<string>> {
    let pop: any = copyRequest(tx);

    if (pop.to != null) { pop.to = resolveAddress(pop.to, signer); }

    if (pop.from != null) {
        pop.from = resolveAddress(pop.from, signer);
    } else {
        pop.from = signer.getAddress();
    }

    return await resolveProperties(pop);
}