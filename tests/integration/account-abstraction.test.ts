import * as chai from "chai";
import "../custom-matchers";
import { Provider, types, utils, Wallet, ContractFactory, SmartAccount } from "../../src";
import { Contract, ethers, Typed } from "ethers";
import { ECDSASmartAccount, MultisigECDSASmartAccount } from "../../src/smart-account";

const { expect } = chai;

describe("Account Abstraction", () => {
    const ADDRESS = "0x36615Cf349d7F6344891B1e7CA7C72883F5dc049";
    const PRIVATE_KEY = "0x7726827caac94a7f9e1b160f7ea819f172f7b6f9d2a97f992c38edeab82d4110";

    const provider = Provider.getDefaultProvider(types.Network.Localhost);
    const wallet = new Wallet(PRIVATE_KEY, provider);

    const tokenPath = "../files/Token.json";
    const paymasterPath = "../files/Paymaster.json";
    const storagePath = "../files/Storage.json";
    const multisigAccountSourcePath = "../files/TwoUserMultisig.json";

    const TOKEN = "0x841c43Fa5d8fFfdB9efE3358906f7578d8700Dd4";
    const PAYMASTER = "0xa222f0c183AFA73a8Bc1AFb48D34C88c9Bf7A174";

    it("use the ERC20 token for paying transaction fee", async () => {
        const INIT_MINT_AMOUNT = 10;
        const MINT_AMOUNT = 3;
        const MINIMAL_ALLOWANCE = 1;

        const abi = require(tokenPath).abi;
        const bytecode: string = require(tokenPath).bytecode;
        const factory = new ContractFactory(abi, bytecode, wallet);
        const tokenContract = (await factory.deploy("Ducat", "Ducat", 18)) as Contract;
        const tokenAddress = await tokenContract.getAddress();

        // mint tokens to wallet, so it could pay fee with tokens
        const mintTx = (await tokenContract.mint(
            Typed.address(await wallet.getAddress()),
            Typed.uint256(INIT_MINT_AMOUNT),
        )) as ethers.ContractTransactionResponse;
        await mintTx.wait();

        const paymasterAbi = require(paymasterPath).abi;
        const paymasterBytecode = require(paymasterPath).bytecode;
        const accountFactory = new ContractFactory(
            paymasterAbi,
            paymasterBytecode,
            wallet,
            "createAccount",
        );
        const paymasterContract = await accountFactory.deploy(tokenAddress);
        const paymasterAddress = await paymasterContract.getAddress();

        // transfer ETH to paymaster so it could pay fee
        const faucetTx = await wallet.transfer({
            token: utils.ETH_ADDRESS,
            to: paymasterAddress,
            amount: ethers.parseEther("0.01"),
        });
        await faucetTx.wait();

        const paymasterBalanceBeforeTx = await provider.getBalance(paymasterAddress);
        const paymasterTokenBalanceBeforeTx = await provider.getBalance(
            paymasterAddress,
            "latest",
            tokenAddress,
        );
        const walletBalanceBeforeTx = await wallet.getBalance();
        const walletTokenBalanceBeforeTx = await wallet.getBalance(tokenAddress);

        // perform tx using paymaster
        const tokenAbi = new ethers.Interface(require(tokenPath).abi);
        const tx = await wallet.sendTransaction({
            to: tokenAddress,
            data: tokenAbi.encodeFunctionData("mint", [await wallet.getAddress(), MINT_AMOUNT]),
            customData: {
                gasPerPubdata: utils.DEFAULT_GAS_PER_PUBDATA_LIMIT,
                paymasterParams: utils.getPaymasterParams(paymasterAddress, {
                    type: "ApprovalBased",
                    token: tokenAddress,
                    minimalAllowance: MINIMAL_ALLOWANCE,
                    innerInput: new Uint8Array(),
                }),
            },
        });
        await tx.wait();

        const paymasterBalanceAfterTx = await provider.getBalance(paymasterAddress);
        const paymasterTokenBalanceAfterTx = await provider.getBalance(
            paymasterAddress,
            "latest",
            tokenAddress,
        );
        const walletBalanceAfterTx = await wallet.getBalance();
        const walletTokenBalanceAfterTx = await wallet.getBalance(tokenAddress);

        expect(paymasterTokenBalanceBeforeTx == BigInt(0)).to.be.true;
        expect(walletTokenBalanceBeforeTx == BigInt(INIT_MINT_AMOUNT)).to.be.true;

        expect(paymasterBalanceBeforeTx - paymasterBalanceAfterTx >= BigInt(0)).to.be.true;
        expect(paymasterTokenBalanceAfterTx === BigInt(MINIMAL_ALLOWANCE)).to.be.true;

        expect(walletBalanceBeforeTx - walletBalanceAfterTx >= BigInt(0)).to.be.true;
        expect(
            walletTokenBalanceAfterTx ==
                walletTokenBalanceBeforeTx - BigInt(MINIMAL_ALLOWANCE) + BigInt(MINT_AMOUNT),
        ).to.be.true;
    }).timeout(30_000);

    it("use multisig account", async () => {
        const account = ECDSASmartAccount.create(ADDRESS, PRIVATE_KEY, provider);

        const multisigAccountAbi = require(multisigAccountSourcePath).abi;
        const multitsigAccountBytecode: string = require(multisigAccountSourcePath).bytecode;
        const factory = new ContractFactory(
            multisigAccountAbi,
            multitsigAccountBytecode,
            account,
            "createAccount",
        );
        const owner1 = Wallet.createRandom();
        const owner2 = Wallet.createRandom();
        const multisigContract = await factory.deploy(owner1.address, owner2.address);
        const multisigAddress = await multisigContract.getAddress();

        // send ETH to multisig account
        await (
            await account.sendTransaction({
                to: multisigAddress,
                value: ethers.parseEther("1"),
            })
        ).wait();

        // send paymaster approval token to multisig account
        const sendApprovalTokenTx = await new Wallet(PRIVATE_KEY, provider).transfer({
            to: multisigAddress,
            token: TOKEN,
            amount: 5,
        });
        await sendApprovalTokenTx.wait();

        console.log(`Multisig balance: ${await provider.getBalance(multisigAddress)}`);

        // deploy storage account which will be called from multisig account
        const storageAbi = require(storagePath).contracts["Storage.sol:Storage"].abi;
        const storageBytecode: string = require(storagePath).contracts["Storage.sol:Storage"].bin;

        const storageFactory = new ContractFactory(storageAbi, storageBytecode, account);
        const storage = (await storageFactory.deploy()) as Contract;

        console.log(`Storage address: ${await storage.getAddress()}`);

        const storageSetTx = await storage.set.populateTransaction(ethers.Typed.uint256(500));

        const multisigAccount = MultisigECDSASmartAccount.create(
            multisigAddress,
            [owner1.signingKey, owner2.signingKey],
            provider,
        );

        const tx = await multisigAccount.sendTransaction({ ...storageSetTx });
        await tx.wait();
        console.log(`Multisig balance: ${await provider.getBalance(multisigAddress)}`);
        console.log(`Storage value: ${await storage.get()}`);

        console.log(
            `Account balance before tx: ${await provider.getBalance(await account.getAddress())}`,
        );
        console.log(
            `Account approval token balance before tx: ${await provider.getBalance(
                await account.getAddress(),
                "latest",
                TOKEN,
            )}`,
        );
        const paymasterSetTx = await storage.set(700, {
            customData: {
                paymasterParams: utils.getPaymasterParams(PAYMASTER, {
                    type: "ApprovalBased",
                    token: TOKEN,
                    minimalAllowance: 1,
                    innerInput: new Uint8Array(),
                }),
            },
        });
        await paymasterSetTx.wait();
        console.log(
            `Account balance after tx: ${await provider.getBalance(await account.getAddress())}`,
        );
        console.log(
            `Account approval token balance afte tx: ${await provider.getBalance(
                await account.getAddress(),
                "latest",
                TOKEN,
            )}`,
        );
        console.log(`Storage value: ${await storage.get()}`);
    }).timeout(25_000);
});
