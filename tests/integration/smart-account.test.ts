import * as chai from "chai";
import "../custom-matchers";
import { ContractFactory, Contract, SmartAccount, Provider, types, utils, Wallet } from "../../src";
import { ethers } from "ethers";
import { populateTransactionMultisig, signTransactionMultisig } from "../../src/smart-account-utils";
import { ECDSASmartAccount } from "../../src/smart-account";

const { expect } = chai;

describe.only("SmartAccount", async () => {
    const ADDRESS = "0x36615Cf349d7F6344891B1e7CA7C72883F5dc049";
    const PRIVATE_KEY = "0x7726827caac94a7f9e1b160f7ea819f172f7b6f9d2a97f992c38edeab82d4110";
    const RECEIVER = "0xa61464658AfeAf65CccaaFD3a512b69A83B77618";

    const provider = Provider.getDefaultProvider(types.Network.Localhost);
    const account = new SmartAccount({ address: ADDRESS, secret: PRIVATE_KEY }, provider);

    const storagePath = "../files/Storage.json";
    const multisigAccountSourcePath = "../files/TwoUserMultisig.json";

    const TOKEN = "0x841c43Fa5d8fFfdB9efE3358906f7578d8700Dd4";
    const PAYMASTER = "0xa222f0c183AFA73a8Bc1AFb48D34C88c9Bf7A174";

    describe("#constructor()", () => {
        it("`SmartAccount(address, privateKeys, provider)` should return a `SmartAccount` with L2 provider", () => {
            const account = new SmartAccount({ address: ADDRESS, secret: PRIVATE_KEY }, provider);
            expect(account.address).to.be.equal(ADDRESS);
            expect(account.secret).to.be.equal(PRIVATE_KEY);
            expect(account.provider).to.be.equal(provider);
        });
        it("`SmartWallet(address, privateKey, provider, transactionSigner, messageSigner)` should return a `SmartAccount` with custom transction signing method", async () => {
            const account = new SmartAccount(
                {
                    address: ADDRESS,
                    secret: PRIVATE_KEY,
                    transactionSigner: async () => {
                        return "0x";
                    },
                    messageSigner: async () => {
                        return "0x";
                    },
                    typedDataSigner: async () => {
                        return "0x";
                    },
                    transactionBuilder: async () => {
                        return {};
                    },
                },
                provider,
            );

            expect(account.address).to.be.equal(ADDRESS);
            expect(account.secret).to.be.equal(PRIVATE_KEY);
            expect(account.provider).to.be.equal(provider);
        });
    });

    describe("#connect()", () => {
        it("should return a `SmartAccount` with provided `provider` as L2 provider", async () => {
            const newProvider = Provider.getDefaultProvider(types.Network.Localhost);
            let account = new SmartAccount({ address: ADDRESS, secret: PRIVATE_KEY }, provider);
            account = account.connect(newProvider);
            expect(account.address).to.be.equal(ADDRESS);
            expect(account.secret).to.be.equal(PRIVATE_KEY);
            expect(account.provider).to.be.equal(newProvider);
        });

        it("should return a `SmartAccount` with no `provider` is provided", async () => {
            let account = new SmartAccount({ address: ADDRESS, secret: PRIVATE_KEY }, provider);
            account = account.connect(null);
            expect(account.address).to.be.equal(ADDRESS);
            expect(account.secret).to.be.equal(PRIVATE_KEY);
            expect(account.provider).to.be.equal(null);
        });
    });

    describe("#getAddress()", () => {
        it("should return the `SmartAccount` address", async () => {
            const account = new SmartAccount({ address: ADDRESS, secret: PRIVATE_KEY }, provider);
            const result = await account.getAddress();
            expect(result).to.be.equal(ADDRESS);
        });
    });

    describe("#getBalance()", () => {
        it("should return a `SmartAccount` balance", async () => {
            const result = await account.getBalance();
            expect(result > 0).to.be.true;
        });
    });

    describe("#getAllBalances()", () => {
        it("should return all balances", async () => {
            const result = await account.getAllBalances();
            expect(Object.keys(result)).to.have.lengthOf(2);
        });
    });

    describe("#getDeploymentNonce()", () => {
        it("should return the deployment nonce", async () => {
            const result = await account.getDeploymentNonce();
            expect(result).not.to.be.null;
        });
    });

    describe("#populateTransaction()", () => {
        it("should return a populated transaction", async () => {
            const tx = {
                to: "0xa61464658AfeAf65CccaaFD3a512b69A83B77618",
                value: BigInt(7_000_000_000),
                type: utils.EIP712_TX_TYPE,
                from: "0x36615Cf349d7F6344891B1e7CA7C72883F5dc049",
                nonce: await account.getNonce("pending"),
                gasLimit: BigInt(154_379),
                chainId: BigInt(270),
                data: "0x",
                customData: { gasPerPubdata: 50_000, factoryDeps: [] },
                gasPrice: BigInt(250_000_000),
            };

            const result = await account.populateTransaction({
                type: utils.EIP712_TX_TYPE,
                to: RECEIVER,
                value: 7_000_000_000,
            });
            expect(result).to.be.deep.equal(tx);
        }).timeout(25_000);

        it("should return a populated transaction with default values if are omitted", async () => {
            const tx = {
                to: RECEIVER,
                value: BigInt(7_000_000),
                type: utils.EIP712_TX_TYPE,
                from: "0x36615Cf349d7F6344891B1e7CA7C72883F5dc049",
                nonce: await account.getNonce("pending"),
                chainId: BigInt(270),
                gasPrice: BigInt(250_000_000),
                data: "0x",
                customData: { gasPerPubdata: 50_000, factoryDeps: [] },
            };
            const result = await account.populateTransaction({
                to: RECEIVER,
                value: 7_000_000,
            });
            expect(result).to.be.deepEqualExcluding(tx, ["gasLimit"]);
        });
    });

    describe("#signTransaction()", () => {
        it("should return a signed EIP712 transaction", async () => {
            const result = await account.signTransaction({
                to: RECEIVER,
                value: ethers.parseEther("1"),
            });
            expect(result).not.to.be.null;
        }).timeout(25_000);
    });

    describe("#signTransaction()", () => {
        it("should return a signed message", async () => {
            const result = await account.signMessage("Hello World!");
            expect(result).to.be.equal(
                "0x7c15eb760c394b0ca49496e71d841378d8bfd4f9fb67e930eb5531485329ab7c67068d1f8ef4b480ec327214ee6ed203687e3fbe74b92367b259281e340d16fd1c",
            );
        }).timeout(25_000);
    });

    describe("#signTypedData()", () => {
        it("should return a signed typed data", async () => {
            const result = await account.signTypedData(
                { name: "Example", version: "1", chainId: 270 },
                {
                    Person: [
                        { name: "name", type: "string" },
                        { name: "age", type: "uint8" },
                    ],
                },
                { name: "John", age: 30 },
            );
            console.log(
                "0xbcaf0673c0c2b0e120165d207d42281d0c6e85f0a7f6b8044b0578a91cf5bda66b4aeb62aca4ae17012a38d71c9943e27285792fa7d788d848f849e3ea2e614b1b",
            );
        }).timeout(25_000);
    });

    // describe("#deploy()", () => {
    //     it("should deploy contract", async () => {
    //         const account = new SmartAccount({ address: ADDRESS, secret: PRIVATE_KEY }, provider);

    //         const abi = require(storagePath).contracts["Storage.sol:Storage"].abi;
    //         const bytecode: string = require(storagePath).contracts["Storage.sol:Storage"].bin;

    //         const factory = new ContractFactory(abi, bytecode, account);
    //         const contract = await factory.deploy();

    //         const code = await provider.getCode(await contract.getAddress());
    //         expect(code).not.to.be.null;
    //     }).timeout(25_000);

    //     it("use multisig account", async () => {
    //         const account = new SmartAccount({ address: ADDRESS, secret: PRIVATE_KEY }, provider);

    //         const multisigAccountAbi = require(multisigAccountSourcePath).abi;
    //         const multitsigAccountBytecode: string = require(multisigAccountSourcePath).bytecode;
    //         const factory = new ContractFactory(
    //             multisigAccountAbi,
    //             multitsigAccountBytecode,
    //             account,
    //             "createAccount",
    //         );
    //         const owner1 = Wallet.createRandom();
    //         const owner2 = Wallet.createRandom();
    //         const multisigContract = await factory.deploy(owner1.address, owner2.address);
    //         const multisigAddress = await multisigContract.getAddress();

    //         // send ETH to multisig account
    //         await (
    //             await account.sendTransaction({
    //                 to: multisigAddress,
    //                 value: ethers.parseEther("1"),
    //             })
    //         ).wait();

    //         // send paymaster approval token to multisig account
    //         const sendApprovalTokenTx = await new Wallet(PRIVATE_KEY, provider).transfer({
    //             to: multisigAddress,
    //             token: TOKEN,
    //             amount: 5,
    //         });
    //         await sendApprovalTokenTx.wait();

    //         console.log(`Multisig balance: ${await provider.getBalance(multisigAddress)}`);

    //         const storageAbi = require(storagePath).contracts["Storage.sol:Storage"].abi;
    //         const storageBytecode: string = require(storagePath).contracts["Storage.sol:Storage"].bin;

    //         const storageFactory = new ContractFactory(storageAbi, storageBytecode, account);
    //         const storage = (await storageFactory.deploy()) as Contract;

    //         console.log(`Storage address: ${await storage.getAddress()}`);

    //         const storageSetTx = await storage.set.populateTransaction(ethers.Typed.uint256(500));

    //         const multisigAccount = new SmartAccount(
    //             {
    //                 address: multisigAddress,
    //                 secret: [owner1.signingKey.privateKey, owner2.signingKey.privateKey],
    //                 transactionSigner: signTransactionMultisig,
    //                 transactionBuilder: populateTransactionMultisig,
    //             },
    //             provider,
    //         );

    //         const tx = await multisigAccount.sendTransaction({ ...storageSetTx });
    //         await tx.wait();
    //         console.log(`Multisig balance: ${await provider.getBalance(multisigAddress)}`);
    //         console.log(`Storage value: ${await storage.get()}`);

    //         console.log(
    //             `Account balance before tx: ${await provider.getBalance(await account.getAddress())}`,
    //         );
    //         console.log(
    //             `Account approval token balance before tx: ${await provider.getBalance(
    //                 await account.getAddress(),
    //                 "latest",
    //                 TOKEN,
    //             )}`,
    //         );
    //         const paymasterSetTx = await storage.set(700, {
    //             customData: {
    //                 paymasterParams: utils.getPaymasterParams(PAYMASTER, {
    //                     type: "ApprovalBased",
    //                     token: TOKEN,
    //                     minimalAllowance: 1,
    //                     innerInput: new Uint8Array(),
    //                 }),
    //             },
    //         });
    //         await paymasterSetTx.wait();
    //         console.log(
    //             `Account balance after tx: ${await provider.getBalance(await account.getAddress())}`,
    //         );
    //         console.log(
    //             `Account approval token balance afte tx: ${await provider.getBalance(
    //                 await account.getAddress(),
    //                 "latest",
    //                 TOKEN,
    //             )}`,
    //         );
    //         console.log(`Storage value: ${await storage.get()}`);

    //         // console.log(`Multisig account balance before tx: ${await provider.getBalance(multisigAddress)}`);
    //         // console.log(`Multisig account approval token balance before tx: ${await provider.getBalance(multisigAddress, 'latest', TOKEN)}`);
    //         // const paymasterMultisigTx = await multisigAccount.sendTransaction({
    //         //     ... await storage.set.populateTransaction(ethers.Typed.uint256(1500)),
    //         //     from: multisigAddress,
    //         //     customData: {
    //         //         paymasterParams: utils.getPaymasterParams(PAYMASTER, {
    //         //             type: "ApprovalBased",
    //         //             token: TOKEN,
    //         //             minimalAllowance: 1,
    //         //             innerInput: new Uint8Array(),
    //         //         })
    //         //     }
    //         // });
    //         // await paymasterMultisigTx.wait();
    //         // console.log(`Multisig account balance after tx: ${await provider.getBalance(multisigAddress)}`);
    //         // console.log(`Multisig account approval token balance afte tx: ${await provider.getBalance(multisigAddress, 'latest', TOKEN)}`);
    //         // console.log(`Storage value: ${await storage.get()}`);
    //     }).timeout(25_000);
    // });
});
